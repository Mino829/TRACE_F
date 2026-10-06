// Checks the hand-written Web Push code against independent implementations:
// http_ece (the RFC 8188/8291 reference library) decrypts what we encrypt as a
// browser would, and node:crypto verifies the VAPID signature.

import assert from "node:assert/strict";
import { createECDH, createPublicKey, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { test } from "node:test";

import ece from "http_ece";

import { encryptPayload, vapidAuthorization } from "../src/webpush.ts";

test("a browser holding the subscription keys can decrypt the payload", async () => {
  const browser = createECDH("prime256v1");
  browser.generateKeys();
  const auth = randomBytes(16);
  const subscription = {
    endpoint: "https://push.example.com/abc",
    keys: { p256dh: browser.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
  };
  const message = JSON.stringify({ title: "TRACE", body: "写真を1枚撮ってください。" });

  const body = await encryptPayload(subscription, new TextEncoder().encode(message));
  const plain = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: browser, authSecret: auth });

  assert.equal(plain.toString("utf8"), message);
});

test("the VAPID header carries a valid ES256 JWT for the endpoint's origin", async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");

  const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/xyz", { publicKey, privateJwk: JSON.stringify(jwk), subject: "mailto:test@example.com" });
  const match = header.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(match, header);
  const [, head, claims, signature, k] = match;

  assert.equal(k, publicKey);
  const payload = JSON.parse(Buffer.from(claims, "base64url").toString());
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.ok(payload.exp > Date.now() / 1000);
  const ok = verify("sha256", Buffer.from(`${head}.${claims}`), { key: createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
  assert.ok(ok, "signature verifies");
});
