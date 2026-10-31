/**
 * Arrival QR URLs carry TRACE_B's signed proof only in the fragment.
 *
 * T2 packs the issuedAt, lifetime, nonce and HMAC into base32. The public
 * venue, checkpoint and key ID travel alongside it, taken from the actual
 * signed payload rather than deployment settings. Packing is used only when
 * rebuilding reproduces the exact signed bytes; other valid proofs travel
 * whole. Only TRACE_B verifies the HMAC.
 */

export type ArrivalPlace = { venue: string; checkpointId: string; keyId: string };

/** T2 binds the reconstructed signed purpose and key ID as well as the venue. */
const PREFIX = "T2";
const NONCE_BYTES = 32;
const MAC_BYTES = 32;
/** issuedAt (4 bytes), the lifetime in seconds (1), the nonce and the MAC. */
const PACKED_BYTES = 5 + NONCE_BYTES + MAC_BYTES;
const PACKED = new RegExp(`^${PREFIX}[A-Z2-7]{${Math.ceil((PACKED_BYTES * 8) / 5)}}$`);

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(bytes: Uint8Array): string {
  let out = "";
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function fromBase32(text: string): Uint8Array {
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const char of text) {
    value = ((value << 5) | BASE32.indexOf(char)) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The signed part, in the field order of TRACE_B's checkpointProof. */
function payloadFor(place: ArrivalPlace, issuedAt: number, expiresAt: number, nonce: Uint8Array): string {
  const json = JSON.stringify({ purpose: "arrival", keyId: place.keyId, checkpointId: place.checkpointId, venue: place.venue, issuedAt, expiresAt, nonce: toBase64Url(nonce) });
  return toBase64Url(new TextEncoder().encode(json));
}

/** A packed code back into TRACE_B's token, or null when the text is not one. */
export function unpackArrivalCode(code: string, place: ArrivalPlace): string | null {
  if (!PACKED.test(code)) return null;
  const bytes = fromBase32(code.slice(PREFIX.length));
  if (toBase32(bytes) !== code.slice(PREFIX.length)) return null;
  const issuedAt = bytes[0] * 2 ** 24 + ((bytes[1] << 16) | (bytes[2] << 8) | bytes[3]);
  const nonce = bytes.subarray(5, 5 + NONCE_BYTES);
  const mac = bytes.subarray(5 + NONCE_BYTES, PACKED_BYTES);
  return `${payloadFor(place, issuedAt, issuedAt + bytes[4], nonce)}.${toBase64Url(mac)}`;
}

/** TRACE_B's token packed, or null when it would not rebuild to the same string. */
export function packArrivalToken(token: string, place: ArrivalPlace): string | null {
  const [payload, mac, ...rest] = token.split(".");
  if (rest.length > 0 || !payload || !mac) return null;
  const json = fromBase64Url(payload);
  const macBytes = fromBase64Url(mac);
  if (!json || macBytes?.length !== MAC_BYTES) return null;
  let proof: unknown;
  try {
    proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    return null;
  }
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return null;
  const { issuedAt, expiresAt, nonce } = proof as Record<string, unknown>;
  if (typeof issuedAt !== "number" || typeof expiresAt !== "number" || typeof nonce !== "string") return null;
  const lifetime = expiresAt - issuedAt;
  const nonceBytes = fromBase64Url(nonce);
  if (!Number.isInteger(issuedAt) || issuedAt < 0 || issuedAt > 0xffffffff || !Number.isInteger(lifetime) || lifetime < 0 || lifetime > 0xff) return null;
  if (nonceBytes?.length !== NONCE_BYTES) return null;
  const bytes = new Uint8Array(PACKED_BYTES);
  bytes.set([issuedAt >>> 24, (issuedAt >>> 16) & 0xff, (issuedAt >>> 8) & 0xff, issuedAt & 0xff, lifetime]);
  bytes.set(nonceBytes, 5);
  bytes.set(macBytes, 5 + NONCE_BYTES);
  const code = PREFIX + toBase32(bytes);
  // The venue, the checkpoint and the JSON's very characters are checked here, by rebuilding.
  return unpackArrivalCode(code, place) === token ? code : null;
}

type ArrivalProof = ArrivalPlace & { issuedAt: number; expiresAt: number; nonce: string; purpose: "arrival" };

export type ArrivalQrRead = { kind: "arrival"; checkpointToken: string } | { kind: "foreign" } | { kind: "invalid" };

/** Structural checks only: an authentic, current signature is the server's decision. */
function readProof(token: string): ArrivalProof | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const payload = fromBase64Url(parts[0]);
  const mac = fromBase64Url(parts[1]);
  if (!payload || mac?.length !== MAC_BYTES || toBase64Url(payload) !== parts[0] || toBase64Url(mac) !== parts[1]) return null;
  let proof: unknown;
  try {
    proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch {
    return null;
  }
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return null;
  const { purpose, keyId, checkpointId, venue, issuedAt, expiresAt, nonce } = proof as Record<string, unknown>;
  if (purpose !== "arrival" || typeof keyId !== "string" || !keyId || typeof checkpointId !== "string" || !checkpointId || typeof venue !== "string" || !venue) return null;
  if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt) || issuedAt < 0 || typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt) || expiresAt < issuedAt) return null;
  if (typeof nonce !== "string") return null;
  const nonceBytes = fromBase64Url(nonce);
  if (nonceBytes?.length !== NONCE_BYTES || toBase64Url(nonceBytes) !== nonce) return null;
  return { purpose, keyId, checkpointId, venue, issuedAt, expiresAt, nonce };
}

function siteOrigin(origin: string): string {
  const url = new URL(origin);
  if (!(url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || (origin !== url.origin && origin !== `${url.origin}/`)) throw new Error("Invalid arrival site origin");
  return url.origin;
}

/** Encode a real signed proof for the normal-camera /log entry point. */
export function arrivalQrUrl(checkpointToken: string, origin: string): string {
  const proof = readProof(checkpointToken);
  if (!proof) throw new Error("Invalid arrival proof");
  const packed = packArrivalToken(checkpointToken, proof);
  const fragment = new URLSearchParams({ arrival: packed ?? checkpointToken });
  if (packed) {
    fragment.set("venue", proof.venue);
    fragment.set("checkpointId", proof.checkpointId);
    fragment.set("keyId", proof.keyId);
  }
  return `${siteOrigin(origin)}/log#${fragment}`;
}

/** Public scanned input is URL-only; foreign proofs are never returned for sending. */
export function readArrivalQrUrl(value: string, origin: string): ArrivalQrRead {
  try {
    if (/[\u0000-\u0020\u007f\\]/.test(value)) return { kind: "invalid" };
    const url = new URL(value);
    const localOrigin = siteOrigin(origin);
    siteOrigin(url.origin);
    // Exact spelling also rejects URL-normalized dot paths, empty queries and userinfo.
    if (url.username || url.password || url.pathname !== "/log" || url.search || value.slice(0, value.indexOf("#")) !== `${url.origin}/log`) return { kind: "invalid" };
    const fragment = url.hash.slice(1);
    if (!fragment || /%(?![0-9a-f]{2})/i.test(fragment)) return { kind: "invalid" };
    decodeURIComponent(fragment); // URLSearchParams alone tolerates malformed UTF-8.
    const params = new URLSearchParams(fragment);
    const keys = new Set<string>();
    for (const [key] of params) {
      if (keys.has(key) || !["arrival", "venue", "checkpointId", "keyId"].includes(key)) return { kind: "invalid" };
      keys.add(key);
    }
    if (fragment.split("&").some((part) => !part.includes("="))) return { kind: "invalid" };
    const arrival = params.get("arrival");
    if (!arrival) return { kind: "invalid" };
    let checkpointToken: string | null;
    if (PACKED.test(arrival)) {
      const venue = params.get("venue");
      const checkpointId = params.get("checkpointId");
      const keyId = params.get("keyId");
      if (keys.size !== 4 || !venue || !checkpointId || !keyId) return { kind: "invalid" };
      checkpointToken = unpackArrivalCode(arrival, { venue, checkpointId, keyId });
    } else {
      if (keys.size !== 1) return { kind: "invalid" };
      checkpointToken = arrival;
    }
    if (!checkpointToken || !readProof(checkpointToken)) return { kind: "invalid" };
    return url.origin === localOrigin ? { kind: "arrival", checkpointToken } : { kind: "foreign" };
  } catch {
    return { kind: "invalid" };
  }
}
