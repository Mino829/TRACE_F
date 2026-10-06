/**
 * Web Push sending with nothing but WebCrypto, so it runs on Workers without
 * Node shims: VAPID (RFC 8292) to identify the sender, aes128gcm (RFC 8291) to
 * encrypt the payload so only the subscribed browser can read it.
 */

export type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type Vapid = {
  /** Uncompressed P-256 public key, base64url — the browser's applicationServerKey. */
  publicKey: string;
  /** The matching private key as a JWK (JSON string). */
  privateJwk: string;
  /** mailto: or https: contact the push service can reach if this sender misbehaves. */
  subject: string;
};

const encoder = new TextEncoder();

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/** RFC 8291 §3–4: one record, so the whole body is header + a single AES-GCM block. */
export async function encryptPayload(subscription: PushSubscriptionJSON, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = base64UrlDecode(subscription.keys.p256dh);
  const authSecret = base64UrlDecode(subscription.keys.auth);

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  // The runtime reads the standard `public` member; workers-types spells it `$public`.
  const ecdh = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(encoder.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 marks the last (and only) record; no padding after it.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(payload, new Uint8Array([2]))));

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/** RFC 8292: a short-lived ES256 JWT scoped to the push service's origin. */
export async function vapidAuthorization(endpoint: string, vapid: Vapid): Promise<string> {
  const { kty, crv, x, y, d } = JSON.parse(vapid.privateJwk) as JsonWebKey;
  const key = await crypto.subtle.importKey("jwk", { kty, crv, x, y, d }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64UrlEncode(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}

export async function sendPush(subscription: PushSubscriptionJSON, payload: unknown, vapid: Vapid, ttlSeconds: number): Promise<Response> {
  const body = await encryptPayload(subscription, encoder.encode(JSON.stringify(payload)));
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(subscription.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttlSeconds),
      Urgency: "high",
    },
    body,
  });
}
