// Publishes everything in one go, in the order that keeps the live site working:
// the D1 migrations, the push worker, the static export of the page, the page.
// Each step goes through scripts/wrangler.mjs, so only this folder's .env is used.
//
//   npm run release            (from push-worker)
//   npm --prefix push-worker run release   (from the repository root)
//
// The page is built against PUSH_API_URL from .env when it is set.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..");
const wrangler = join(root, "scripts", "wrangler.mjs");

function fromEnvFile(name) {
  const file = join(root, ".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && match[1] === name) return match[2];
  }
  return undefined;
}

const pushUrl = fromEnvFile("PUSH_API_URL") || "https://trace-push.uni11260609.workers.dev";

const steps = [
  ["マイグレーションを本番の D1 に適用", [wrangler, "d1", "migrations", "apply", "DB", "--remote"], root, {}],
  ["通知サーバー（trace-push）をデプロイ", [wrangler, "deploy"], root, {}],
  ["ページを静的に書き出し", [join(repo, "node_modules", "next", "dist", "bin", "next"), "build"], repo, { NEXT_STATIC_EXPORT: "1", NEXT_PUBLIC_PUSH_API_URL: pushUrl }],
  ["ページ（trace-log）をデプロイ", [wrangler, "deploy", "--config", "site.wrangler.jsonc"], root, {}],
];

for (const [index, [label, args, cwd, extra]] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${label}`);
  const result = spawnSync(process.execPath, args, { cwd, env: { ...process.env, ...extra }, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n[${index + 1}/${steps.length}] ${label} に失敗しました。ここで止めます。`);
    process.exit(result.status ?? 1);
  }
}
console.log("\nすべて完了しました。");
