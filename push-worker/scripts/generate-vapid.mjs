// Makes a VAPID key pair for Web Push and writes it to .vapid.json (git-ignored).
// Keep a copy somewhere the team can reach: subscriptions are tied to the public
// key, so losing it means every phone has to subscribe again.
//
//   node scripts/generate-vapid.mjs

import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", ".vapid.json");
if (existsSync(out)) {
  console.error(".vapid.json は既にあります。作り直すと登録済みの端末に通知が届かなくなるため、中止しました。");
  process.exit(1);
}

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]).toString("base64url");

writeFileSync(out, JSON.stringify({ VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_JWK: JSON.stringify(jwk) }, null, 2));
console.log("push-worker/.vapid.json に VAPID 鍵を書き出しました。");
