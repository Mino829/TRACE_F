/**
 * The booth's arrival QR in fewer modules.
 *
 * TRACE_B signs a token (internal/api/arrivals.go): base64url JSON of purpose,
 * keyId, checkpointId, venue, issuedAt, expiresAt and a 32-byte nonce, a dot,
 * and the base64url HMAC-SHA256 of that first part. The purpose, public key ID,
 * and the checkpoint are the same in every token and the JSON's shape is fixed,
 * so the display packs only issuedAt, the lifetime, the nonce and the MAC, 69
 * bytes, as base32, which a QR holds in its alphanumeric mode: 33×33 modules at
 * error correction L instead of 61×61 at M. The phone rebuilds the very string
 * TRACE_B signed and sends that, so TRACE_B sees no difference.
 *
 * The venue, checkpoint and public key ID come from NEXT_PUBLIC_ARRIVAL_VENUE,
 * NEXT_PUBLIC_ARRIVAL_CHECKPOINT_ID and NEXT_PUBLIC_ARRIVAL_PROOF_KEY_ID
 * (default arrival-proof-v1). They must match TRACE_B. A token that does not
 * rebuild exactly goes on the QR whole. T1 codes from the retired unsigned-
 * purpose format are not reconstructed.
 */

export type ArrivalPlace = { venue: string; checkpointId: string; keyId: string };

const VENUE = process.env.NEXT_PUBLIC_ARRIVAL_VENUE ?? "";
const CHECKPOINT_ID = process.env.NEXT_PUBLIC_ARRIVAL_CHECKPOINT_ID ?? "";
const KEY_ID = process.env.NEXT_PUBLIC_ARRIVAL_PROOF_KEY_ID ?? "arrival-proof-v1";

export const ARRIVAL_PLACE: ArrivalPlace | null = VENUE && CHECKPOINT_ID && KEY_ID ? { venue: VENUE, checkpointId: CHECKPOINT_ID, keyId: KEY_ID } : null;

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
export function unpackArrivalCode(code: string, place: ArrivalPlace | null = ARRIVAL_PLACE): string | null {
  if (!place || !PACKED.test(code)) return null;
  const bytes = fromBase32(code.slice(PREFIX.length));
  const issuedAt = bytes[0] * 2 ** 24 + ((bytes[1] << 16) | (bytes[2] << 8) | bytes[3]);
  const nonce = bytes.subarray(5, 5 + NONCE_BYTES);
  const mac = bytes.subarray(5 + NONCE_BYTES, PACKED_BYTES);
  return `${payloadFor(place, issuedAt, issuedAt + bytes[4], nonce)}.${toBase64Url(mac)}`;
}

/** TRACE_B's token packed, or null when it would not rebuild to the same string. */
export function packArrivalToken(token: string, place: ArrivalPlace | null = ARRIVAL_PLACE): string | null {
  const [payload, mac, ...rest] = token.split(".");
  if (!place || rest.length > 0 || !payload || !mac) return null;
  const json = fromBase64Url(payload);
  const macBytes = fromBase64Url(mac);
  if (!json || macBytes?.length !== MAC_BYTES) return null;
  let proof: { issuedAt?: unknown; expiresAt?: unknown; nonce?: unknown };
  try {
    proof = JSON.parse(new TextDecoder().decode(json));
  } catch {
    return null;
  }
  const { issuedAt, expiresAt, nonce } = proof;
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

/** Whether a read text is a packed arrival code (it may still fail to rebuild without the settings). */
export function isPackedArrivalCode(text: string): boolean {
  return PACKED.test(text);
}

/** What the booth's QR shows for a token: packed when it rebuilds exactly, the token itself otherwise. */
export function arrivalQrText(token: string, place: ArrivalPlace | null = ARRIVAL_PLACE): string {
  return packArrivalToken(token, place) ?? token;
}

/** The token to send for a read arrival code: rebuilt from a packed code, or the text as it was read. */
export function arrivalTokenFor(text: string, place: ArrivalPlace | null = ARRIVAL_PLACE): string {
  return unpackArrivalCode(text, place) ?? text;
}
