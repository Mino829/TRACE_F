import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { test } from "node:test";

import { arrivalQrText, arrivalTokenFor, isPackedArrivalCode, packArrivalToken, unpackArrivalCode } from "./arrival-code.ts";

const place = { venue: "shibalab-301", checkpointId: "arrival-booth", keyId: "arrival-proof-v1" };
const b64 = (data) => Buffer.from(data).toString("base64url");

/** A token as TRACE_B's internal/api/arrivals.go signs it: the proof's JSON in field order, a 32-byte nonce, 25 s. */
function traceToken({ json, nonceBytes = 32, issuedAt = 1_792_900_000, lifetime = 25 } = {}) {
  const proof = { purpose: "arrival", keyId: place.keyId, checkpointId: place.checkpointId, venue: place.venue, issuedAt, expiresAt: issuedAt + lifetime, nonce: b64(randomBytes(nonceBytes)) };
  const payload = b64(json ? json(proof) : JSON.stringify(proof));
  return `${payload}.${b64(createHmac("sha256", "proof-key").update(payload).digest())}`;
}

test("a token packs into 113 characters a QR holds in alphanumeric mode, and back", () => {
  for (let i = 0; i < 200; i++) {
    const token = traceToken({ issuedAt: 1_792_900_000 + i * 15 });
    const code = packArrivalToken(token, place);
    assert.equal(code.length, 113);
    assert.match(code, /^[0-9A-Z]+$/);
    assert.ok(isPackedArrivalCode(code));
    assert.equal(unpackArrivalCode(code, place), token);
    assert.equal(arrivalTokenFor(code, place), token);
  }
});

test("the ends of issuedAt and the lifetime survive", () => {
  for (const [issuedAt, lifetime] of [
    [0, 0],
    [0xffffffff - 255, 255],
  ]) {
    const token = traceToken({ issuedAt, lifetime });
    assert.equal(unpackArrivalCode(packArrivalToken(token, place), place), token);
  }
});

test("a token that would not rebuild exactly goes on the QR whole", () => {
  const cases = {
    "another venue": traceToken({ json: (proof) => JSON.stringify({ ...proof, venue: "shibalab-302" }) }),
    "another purpose": traceToken({ json: (proof) => JSON.stringify({ ...proof, purpose: "renderer" }) }),
    "another key ID": traceToken({ json: (proof) => JSON.stringify({ ...proof, keyId: "other-proof-key" }) }),
    "retired missing purpose": traceToken({ json: (proof) => {
      const retired = { ...proof };
      delete retired.purpose;
      delete retired.keyId;
      return JSON.stringify(retired);
    } }),
    "another field order": traceToken({ json: ({ venue, ...proof }) => JSON.stringify({ venue, ...proof }) }),
    "a shorter nonce": traceToken({ nonceBytes: 18 }),
    "a lifetime over 255 s": traceToken({ lifetime: 256 }),
    "a fractional issuedAt": traceToken({ issuedAt: 1_792_900_000.5 }),
    "spaces in the JSON": traceToken({ json: (proof) => JSON.stringify(proof, null, 1) }),
    "a third part": `${traceToken()}.x`,
    "not base64url": "a+b.c/d",
  };
  for (const [name, token] of Object.entries(cases)) {
    assert.equal(packArrivalToken(token, place), null, name);
    assert.equal(arrivalQrText(token, place), token, name);
  }
});

test("Go's escaped < in a venue does not pack", () => {
  const odd = { ...place, venue: "lab<301>" };
  const json = (proof) => JSON.stringify({ ...proof, venue: odd.venue }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const token = traceToken({ json });
  assert.equal(packArrivalToken(token, odd), null);
});

test("without the venue and the checkpoint, nothing packs or unpacks", () => {
  const token = traceToken();
  const code = packArrivalToken(token, place);
  assert.equal(packArrivalToken(token, null), null);
  assert.equal(arrivalQrText(token, null), token);
  assert.equal(unpackArrivalCode(code, null), null);
  // Sent as read; TRACE_B refuses it.
  assert.equal(arrivalTokenFor(code, null), code);
});

test("only a whole packed code in upper case is one", () => {
  const code = packArrivalToken(traceToken(), place);
  assert.ok(isPackedArrivalCode(code));
  for (const text of [code.toLowerCase(), code.slice(0, -1), `${code}A`, `T1${code.slice(2)}`, `${code.slice(0, 9)}1${code.slice(10)}`,"https://trace.example/log"]) {
    assert.equal(isPackedArrivalCode(text), false, text);
    assert.equal(unpackArrivalCode(text, place), null, text);
    assert.equal(arrivalTokenFor(text, place), text);
  }
});
