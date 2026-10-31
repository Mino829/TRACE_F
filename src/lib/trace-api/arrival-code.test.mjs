import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { arrivalQrUrl, readArrivalQrUrl, packArrivalToken, unpackArrivalCode } from "./arrival-code.ts";

const place = { venue: "shibalab-301", checkpointId: "arrival-booth", keyId: "arrival-proof-v1" };
const origin = "https://trace.example";
const b64 = (data) => Buffer.from(data).toString("base64url");

/** TRACE_B's checkpointProof field order, nonce size and signed payload bytes. */
function traceToken({ json, context = place, nonceBytes = 32, issuedAt = 1_792_900_000, lifetime = 25 } = {}) {
  const proof = { purpose: "arrival", keyId: context.keyId, checkpointId: context.checkpointId, venue: context.venue, issuedAt, expiresAt: issuedAt + lifetime, nonce: b64(Uint8Array.from({ length: nonceBytes }, (_, index) => index & 255)) };
  const payload = b64(json ? json(proof) : JSON.stringify(proof));
  return `${payload}.${b64(createHmac("sha256", "proof-key").update(payload).digest())}`;
}

function assertRoundTrip(token, site = origin) {
  const link = arrivalQrUrl(token, site);
  const read = readArrivalQrUrl(link, site);
  assert.deepEqual(read, { kind: "arrival", checkpointToken: token });
  const [payload, mac] = read.checkpointToken.split(".");
  assert.equal(mac, b64(createHmac("sha256", "proof-key").update(payload).digest()));
  return new URL(link);
}

test("a signed token packs into 113 alphanumeric characters and survives a URL exactly", () => {
  for (let i = 0; i < 200; i++) {
    const token = traceToken({ issuedAt: 1_792_900_000 + i * 15 });
    const code = packArrivalToken(token, place);
    assert.equal(code.length, 113);
    assert.match(code, /^T2[A-Z2-7]+$/);
    assert.equal(unpackArrivalCode(code, place), token);
    const link = assertRoundTrip(token);
    assert.equal(link.origin, origin);
    assert.equal(link.pathname, "/log");
    assert.equal(link.search, "");
    const params = new URLSearchParams(link.hash.slice(1));
    assert.deepEqual([...params], [["arrival", code], ["venue", place.venue], ["checkpointId", place.checkpointId], ["keyId", place.keyId]]);
    // The network request contains only the landing page, never the signed proof.
    link.hash = "";
    assert.equal(link.href, `${origin}/log`);
  }
});

test("public context comes from each signed payload, including escaped fragment characters", () => {
  for (const context of [
    { venue: "another-venue", checkpointId: "other-booth", keyId: "other-public-key" },
    { venue: "会場 & # ? + /", checkpointId: "arrival=1&arrival=2", keyId: "public key + ID" },
  ]) {
    const token = traceToken({ context });
    const link = assertRoundTrip(token);
    const params = new URLSearchParams(link.hash.slice(1));
    assert.match(params.get("arrival"), /^T2/);
    for (const [key, value] of Object.entries(context)) assert.equal(params.get(key), value);
    assert.equal(packArrivalToken(token, place), null);
  }
});

test("the packed issuedAt and lifetime boundaries survive", () => {
  for (const [issuedAt, lifetime] of [[0, 0], [0xffffffff - 255, 255], [0xffffffff, 255]]) {
    const token = traceToken({ issuedAt, lifetime });
    assert.equal(unpackArrivalCode(packArrivalToken(token, place), place), token);
    assertRoundTrip(token);
  }
});

test("valid signed bytes that cannot pack travel whole in the fragment", () => {
  const cases = {
    "another field order": traceToken({ json: ({ venue, ...proof }) => JSON.stringify({ venue, ...proof }) }),
    "a lifetime over 255 s": traceToken({ lifetime: 256 }),
    "issuedAt beyond uint32": traceToken({ issuedAt: 0x100000000 }),
    "spaces in the JSON": traceToken({ json: (proof) => JSON.stringify(proof, null, 1) }),
    "Go escaped HTML": traceToken({ json: (proof) => JSON.stringify({ ...proof, venue: "lab<301>" }).replace(/</g, "\\u003c").replace(/>/g, "\\u003e") }),
  };
  for (const [name, token] of Object.entries(cases)) {
    assert.equal(packArrivalToken(token, place), null, name);
    const params = new URLSearchParams(assertRoundTrip(token).hash.slice(1));
    assert.deepEqual([...params], [["arrival", token]], name);
  }
});

test("malformed, unrelated and retired signed payloads are not arrival URLs", () => {
  const valid = traceToken();
  const [payload, mac] = valid.split(".");
  const cases = [
    traceToken({ json: (proof) => JSON.stringify({ ...proof, purpose: "renderer" }) }),
    traceToken({ json: ({ purpose, keyId, ...proof }) => JSON.stringify(proof) }),
    traceToken({ json: (proof) => JSON.stringify({ ...proof, venue: "" }) }),
    traceToken({ json: (proof) => JSON.stringify({ ...proof, checkpointId: null }) }),
    traceToken({ json: (proof) => JSON.stringify({ ...proof, keyId: 42 }) }),
    traceToken({ nonceBytes: 18 }),
    traceToken({ issuedAt: 1_792_900_000.5 }),
    traceToken({ issuedAt: -1 }),
    traceToken({ lifetime: -1 }),
    traceToken({ json: () => "null" }),
    traceToken({ json: () => "[]" }),
    traceToken({ json: () => "{" }),
    `${payload}.${mac.slice(1)}`,
    `${payload}=.${mac}`,
    `${valid}.x`,
    "a+b.c/d",
    `${b64(Buffer.from([0xff]))}.${mac}`,
  ];
  for (const token of cases) {
    assert.throws(() => arrivalQrUrl(token, origin), /Invalid arrival proof/);
    assert.deepEqual(readArrivalQrUrl(`${origin}/log#${new URLSearchParams({ arrival: token })}`, origin), { kind: "invalid" });
  }
});

test("valid foreign origin links report foreign without returning a token", () => {
  const token = traceToken();
  for (const foreign of ["https://old.example", "https://trace.example:8443", "https://trace.example.evil", "http://localhost:3000"]) {
    assert.deepEqual(readArrivalQrUrl(arrivalQrUrl(token, foreign), origin), { kind: "foreign" });
  }
  assert.deepEqual(readArrivalQrUrl("https://old.example/log#arrival=garbage", origin), { kind: "invalid" });
});

test("only HTTPS or explicit local-development HTTP origins are accepted", () => {
  const token = traceToken();
  for (const local of ["http://localhost:3000", "http://127.0.0.1:3000"]) assertRoundTrip(token, local);
  for (const invalid of ["http://trace.example", "http://localhost.evil", "http://192.168.1.2", "ftp://trace.example", "https://user:password@trace.example", `${origin}/log`, `${origin}?x=1`, `${origin}#x`]) {
    assert.throws(() => arrivalQrUrl(token, invalid), /Invalid arrival site origin/);
    assert.deepEqual(readArrivalQrUrl(arrivalQrUrl(token, origin), invalid), { kind: "invalid" });
  }
});

test("raw tokens, opaque codes and ambiguous or unrelated URLs cannot become arrivals", () => {
  const token = traceToken();
  const link = arrivalQrUrl(token, origin);
  const hash = new URL(link).hash;
  const params = new URLSearchParams(hash.slice(1));
  const code = params.get("arrival");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const badPadding = code.slice(0, -1) + alphabet[alphabet.indexOf(code.at(-1)) | 1];
  const cases = [
    token, code, "", "/log" + hash, "//trace.example/log" + hash,
    `${origin}/log`, `${origin}/log#`, `${origin}/log#${token}`,
    `${origin}/${hash}`, `${origin}/display${hash}`, `${origin}/log/${hash}`,
    `${origin}/a/../log${hash}`, `${origin}/%6cog${hash}`,
    `${origin}/log?${hash}`, `${origin}/log?arrival=${token}${hash}`,
    `https://user@trace.example/log${hash}`, `https://user:password@trace.example/log${hash}`,
    `http://trace.example/log${hash}`, `javascript:${link}`, ` ${link}`, `${link}\n`,
    `https:\\trace.example\\log${hash}`,
    `${link}&arrival=${code}`, `${link}&%61rrival=${code}`,
    `${link}&venue=another`, `${link}&checkpointId=another`, `${link}&keyId=another`,
    `${link}&unexpected=value`, `${link}&`, `${link}&&`, `${link}&empty`,
    `${link}&bad=%`, `${link}&bad=%GG`, `${link}&bad=%FF`,
    link.replace("venue=", "venue=%FF"),
    link.replace(`arrival=${code}`, "arrival="),
    link.replace(`arrival=${code}`, `arrival=${code.toLowerCase()}`),
    link.replace(`arrival=${code}`, `arrival=T1${code.slice(2)}`),
    link.replace(`arrival=${code}`, `arrival=${badPadding}`),
    link.replace(`arrival=${code}`, `arrival=${code.slice(0, -1)}`),
    `${origin}/log#arrival=${code}`,
    `${origin}/log#arrival=${token}&venue=${place.venue}`,
  ];
  for (const key of ["venue", "checkpointId", "keyId"]) {
    const missing = new URLSearchParams(params);
    missing.delete(key);
    cases.push(`${origin}/log#${missing}`);
    missing.set(key, "");
    cases.push(`${origin}/log#${missing}`);
  }
  assert.equal(unpackArrivalCode(badPadding, place), null);
  for (const value of cases) assert.deepEqual(readArrivalQrUrl(value, origin), { kind: "invalid" }, value);
});
