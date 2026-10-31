// Publishes everything in one go, in the order that keeps the live site working:
// the D1 migrations, the push worker, the static export of the page, the page.
// Each step goes through scripts/wrangler.mjs, so only this folder's .env is used.
//
//   npm run release            (from push-worker)
//   npm --prefix push-worker run release   (from the repository root)
//
// The page is built against PUSH_API_URL from .env when it is set. /log joins
// TRACE_B through the site's /api/backend by default; set trace-production's two
// backend secrets before deployment. TRACE_API_URL can override this base path.
// When .env sets both DISPLAY_API_URL and GOOGLE_CLIENT_ID, /display signs the
// operator in with Google and connects to TRACE_B directly (no relay).

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

const pushUrl = fromEnvFile("PUSH_API_URL") || "https://trace-push.async5855.workers.dev";
const traceApiUrl = fromEnvFile("TRACE_API_URL") || "/api/backend";
// Public arrival proof context: /log reconstructs the exact signed QR payload.
const arrivalVenue = fromEnvFile("ARRIVAL_VENUE");
const arrivalCheckpointId = fromEnvFile("ARRIVAL_CHECKPOINT_ID");
const arrivalProofKeyId = fromEnvFile("ARRIVAL_PROOF_KEY_ID") || "arrival-proof-v1";
const arrivalIssuerUrl = fromEnvFile("ARRIVAL_ISSUER_URL") || "";
// TRACE_B's own origin (not this site's /api/backend) and the Web client ID in TRACE_B's TRACE_DISPLAY_GOOGLE_CLIENT_ID.
const displayApiUrl = fromEnvFile("DISPLAY_API_URL");
const googleClientId = fromEnvFile("GOOGLE_CLIENT_ID");
const pageEnv = {
  NEXT_STATIC_EXPORT: "1",
  NEXT_PUBLIC_PUSH_API_URL: pushUrl,
  NEXT_PUBLIC_TRACE_API_URL: traceApiUrl,
  ...(arrivalVenue && arrivalCheckpointId ? { NEXT_PUBLIC_ARRIVAL_VENUE: arrivalVenue, NEXT_PUBLIC_ARRIVAL_CHECKPOINT_ID: arrivalCheckpointId } : {}),
  NEXT_PUBLIC_ARRIVAL_PROOF_KEY_ID: arrivalProofKeyId,
  NEXT_PUBLIC_ARRIVAL_ISSUER_URL: arrivalIssuerUrl,
  ...(displayApiUrl && googleClientId ? { NEXT_PUBLIC_DISPLAY_API_URL: displayApiUrl, NEXT_PUBLIC_GOOGLE_CLIENT_ID: googleClientId } : {}),
};

const steps = [
  ["マイグレーションを本番の D1 に適用", [wrangler, "d1", "migrations", "apply", "DB", "--remote"], root, {}],
  ["通知サーバー（trace-push）をデプロイ", [wrangler, "deploy"], root, {}],
  ["ページを静的に書き出し", [join(repo, "node_modules", "next", "dist", "bin", "next"), "build"], repo, pageEnv],
  ["ページ（trace-production）をデプロイ", [wrangler, "deploy", "--config", "site.wrangler.jsonc"], root, {}],
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
