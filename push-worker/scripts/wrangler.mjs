// Runs wrangler with this folder's .env and a wrangler config directory of its
// own, so it never reads or replaces a Cloudflare login stored elsewhere on the
// machine (`wrangler login` keeps one per user, not per project).
//
//   node scripts/wrangler.mjs <wrangler args...>

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");
if (!existsSync(envFile)) {
  console.error("push-worker/.env がありません。CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID を書いてください。");
  process.exit(1);
}

const env = { ...process.env, XDG_CONFIG_HOME: join(root, ".wrangler-home"), WRANGLER_SEND_METRICS: "false" };
for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (match) env[match[1]] = match[2];
}
if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
  console.error("push-worker/.env に CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID の両方が必要です。");
  process.exit(1);
}

const bin = join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd: root, env, stdio: "inherit" });
process.exit(result.status ?? 1);
