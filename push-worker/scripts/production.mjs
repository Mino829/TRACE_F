// Isolated production only. Never call the rehearsal .env/Wrangler wrapper.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(workerRoot, "..");
const output = join(repo, ".production-build");
const source = join(output, "source");
const manifestPath = join(output, "manifest.json");
const wranglerPath = join(output, "wrangler.json");
const workerName = "trace-production";
const backendOrigin = "https://trace-backend-350621330046.asia-northeast1.run.app";

class ProductionError extends Error {}

function requireThat(condition, message) {
  if (!condition) throw new ProductionError(message);
}

function publicConfig() {
  const [command, flag, path, ...extra] = process.argv.slice(2);
  requireThat(["build", "validate", "deploy"].includes(command) && flag === "--config" && path && !extra.length,
    "使い方: production.mjs build|validate|deploy --config push-worker/production.public.json");
  requireThat(resolve(path) === join(workerRoot, "production.public.json"), "本番設定はリポジトリ内のproduction.public.jsonだけを使用してください。");
  let config;
  try { config = JSON.parse(readFileSync(resolve(path), "utf8")); }
  catch { throw new ProductionError("本番公開JSONを読めません（.envは使用しません）。"); }
  const fields = ["worker", "origin", "backendUrl", "googleClientId", "operatorBrokerUrl", "cloudflareAccountId", "cloudflareAccountName", "workersDevSubdomain"];
  requireThat(config && typeof config === "object" && !Array.isArray(config), "本番設定はJSON objectが必要です。");
  requireThat(Object.keys(config).length === fields.length && fields.every((field) => typeof config[field] === "string" && config[field] && config[field].trim() === config[field]),
    `本番公開JSONには次の公開文字列だけを指定してください: ${fields.join(", ")}。secretは指定できません。`);
  requireThat(config.worker === workerName, "Worker名はtrace-productionだけが許可されています。");
  requireThat(config.cloudflareAccountId === "297be09d2f1bfb28bb483bd6e6daae9d", "承認されたCloudflare account IDだけを指定してください。");
  requireThat(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(config.workersDevSubdomain), "実際のworkers.dev subdomainが必要です。");
  requireThat(config.origin === `https://${workerName}.${config.workersDevSubdomain}.workers.dev`, "originはtrace-productionと指定したworkers.dev subdomainのHTTPS originに完全一致させてください。");
  requireThat(config.backendUrl === backendOrigin, "backendUrlはtrace-fes-2026 / trace-backendのcanonical Cloud Run HTTPS originに完全一致させてください。");
  requireThat(/^350621330046-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(config.googleClientId), "trace-fes-2026（project number 350621330046）で作成した実Google Web OAuth client IDが必要です。");
  requireThat(config.operatorBrokerUrl === "/api/operator", "本番operatorBrokerUrlは同一originの/api/operatorだけが許可されています。");
  const ordered = Object.fromEntries(fields.map((field) => [field, config[field]]));
  const digest = createHash("sha256").update(JSON.stringify(ordered)).digest("hex");
  return { command, config: ordered, digest };
}

// Do not inherit NEXT_PUBLIC_*, NODE_OPTIONS, auth tokens, or Edge values into Next.
function baseEnv() {
  return Object.fromEntries(["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SYSTEMROOT"]
    .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
}


function wranglerConfig(config) {
  return {
    name: workerName,
    account_id: config.cloudflareAccountId,
    main: "worker/site.ts",
    compatibility_date: "2026-09-01",
    workers_dev: true,
    preview_urls: false,
    triggers: { crons: [] },
    assets: {
      directory: "source/out",
      binding: "ASSETS",
      run_worker_first: ["/api/backend/*", "/api/operator/*"],
      html_handling: "auto-trailing-slash",
      not_found_handling: "404-page",
    },
    vars: { TRACE_BACKEND_URL: config.backendUrl, TRACE_OPERATOR_ALLOWED_ORIGIN: config.origin },
  };
}

// Bind the isolated Worker source and every static asset to the successful build.
function artifactDigest() {
  const hash = createHash("sha256");
  function visit(directory) {
    for (const entry of readdirSync(join(output, directory), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else {
        requireThat(entry.isFile(), "本番成果物に通常ファイル以外が含まれています。buildし直してください。");
        hash.update(JSON.stringify(path)).update("\0").update(createHash("sha256").update(readFileSync(join(output, path))).digest());
      }
    }
  }
  visit("worker");
  visit("source/out");
  return hash.digest("hex");
}
function build(config, digest) {
  // Invalidate old deployable artifacts before starting; never touch rehearsal out/.
  rmSync(output, { recursive: true, force: true });
  mkdirSync(source, { recursive: true });
  const inputs = ["src", "public", "models/trace/campus_graph.json", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs"];
  for (const input of inputs) {
    const destination = join(source, input);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repo, input), destination, {
      recursive: true,
      filter: (entry) => !entry.split(/[\\/]/).some((part) => part.startsWith(".env") || part === ".dev.vars"),
    });
  }
  // Do not copy ignored next-env.d.ts: Next generates it inside this clean snapshot.
  symlinkSync(join(repo, "node_modules"), join(source, "node_modules"), "dir");
  mkdirSync(join(output, "worker"));
  cpSync(join(workerRoot, "src", "site.ts"), join(output, "worker", "site.ts"));
  const result = spawnSync(process.execPath, [join(repo, "node_modules", "next", "dist", "bin", "next"), "build", "--webpack"], {
    cwd: source,
    env: {
      ...baseEnv(),
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_STATIC_EXPORT: "1",
      NEXT_PUBLIC_TRACE_API_URL: "/api/backend",
      NEXT_PUBLIC_PUSH_API_URL: "",
      NEXT_PUBLIC_DISPLAY_API_URL: config.backendUrl,
      NEXT_PUBLIC_GOOGLE_CLIENT_ID: config.googleClientId,
      NEXT_PUBLIC_SITE_ORIGIN: config.origin,
      NEXT_PUBLIC_ARRIVAL_ISSUER_URL: config.operatorBrokerUrl,
    },
    stdio: "inherit",
  });
  requireThat(result.status === 0, "本番静的buildが失敗しました。deploy可能なmanifestは作成しません。");
  requireThat(existsSync(join(source, "out", "index.html")), "本番静的exportが見つかりません。");
  writeFileSync(wranglerPath, `${JSON.stringify(wranglerConfig(config), null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify({ digest, config, artifactDigest: artifactDigest() }, null, 2)}\n`);
  console.log("本番専用buildを .production-build/ に作成しました。リハーサル out/ は変更していません。");
}


async function cloudflare(token, path) {
  let response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
  } catch { throw new ProductionError("Cloudflare APIへ接続できません。secretやprovider応答本文は出力しません。"); }
  let payload;
  try { payload = await response.json(); }
  catch { throw new ProductionError(`Cloudflare API応答が不正です（HTTP ${response.status}）。`); }
  requireThat(response.ok && payload.success, `Cloudflare API操作が失敗しました（HTTP ${response.status}）。権限と対象を確認してください。`);
  return payload.result;
}

function cloudflareToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const authHome = process.env.TRACE_PRODUCTION_AUTH_HOME;
  requireThat(Boolean(token) !== Boolean(authHome), "CLOUDFLARE_API_TOKEN または TRACE_PRODUCTION_AUTH_HOME のどちらか一方だけを明示してください。");
  if (token) {
    requireThat(!/[\r\n]/.test(token), "CLOUDFLARE_API_TOKENの形式が不正です。");
    return token;
  }
  requireThat(isAbsolute(authHome) && existsSync(authHome), "TRACE_PRODUCTION_AUTH_HOMEは親担当者が確認した公式Wrangler認証のXDG_CONFIG_HOME絶対パスが必要です。");
  // Official OAuth/keychain handling, including refresh. Capture both streams;
  // auth token prints credentials, so never inherit its stdio or disk logger.
  const result = spawnSync(process.execPath, [join(workerRoot, "node_modules", "wrangler", "bin", "wrangler.js"), "auth", "token", "--json", "--config", wranglerPath], {
    cwd: output,
    env: {
      ...baseEnv(),
      XDG_CONFIG_HOME: authHome,
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_WRITE_LOGS: "false",
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
      CI: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 64 * 1024,
  });
  requireThat(result.status === 0, "公式Wrangler OAuth認証を取得できません。親担当者が同じ認証homeのlogin状態を確認してください（子プロセス出力は秘密保護のため非表示）。");
  let credentials;
  try { credentials = JSON.parse(result.stdout); }
  catch { throw new ProductionError("公式Wrangler認証応答を解釈できません。応答本文は出力しません。"); }
  requireThat(credentials.type === "oauth" && typeof credentials.token === "string" && credentials.token && !/[\r\n]/.test(credentials.token),
    "指定した公式Wrangler認証homeからOAuth tokenを取得できません。");
  return credentials.token;
}

async function validate(config, digest) {
  let manifest;
  let wrangler;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    wrangler = JSON.parse(readFileSync(wranglerPath, "utf8"));
  } catch { throw new ProductionError("本番専用buildがありません、または設定が不正です。同じ公開JSONでbuild:productionを先に実行してください。"); }
  requireThat(manifest.digest === digest && JSON.stringify(manifest.config) === JSON.stringify(config), "build時と配備時の本番設定が一致しません。buildし直してください。");
  requireThat(existsSync(join(source, "out", "index.html")), "本番buildの成果物が不足しています。");
  requireThat(JSON.stringify(wrangler) === JSON.stringify(wranglerConfig(config)), "本番専用Wrangler設定が不正です。buildし直してください。");
  requireThat(manifest.artifactDigest === artifactDigest(), "本番成果物がbuild後に変更されています。buildし直してください。");
  const token = cloudflareToken();
  const accountPath = `/accounts/${config.cloudflareAccountId}`;
  const account = await cloudflare(token, accountPath);
  requireThat(account.id === config.cloudflareAccountId && account.name === config.cloudflareAccountName, "Cloudflare account ID/nameが指定値に一致しません。変更せず停止します。");
  const subdomain = await cloudflare(token, `${accountPath}/workers/subdomain`);
  requireThat(subdomain.subdomain === config.workersDevSubdomain, "Cloudflare workers.dev subdomainが指定値に一致しません。変更せず停止します。");
  const bindings = await cloudflare(token, `${accountPath}/workers/scripts/${workerName}/secrets`);
  requireThat(Array.isArray(bindings) && bindings.some((binding) => binding.name === "TRACE_EDGE_SHARED_SECRET" && binding.type === "secret_text"),
    "既存trace-productionにTRACE_EDGE_SHARED_SECRET bindingがありません。公開・変更せず停止します。初回設定は承認済み担当者の別操作です。");
  return { token, accountPath };
}

async function deploy(config, credentials) {
  const { token, accountPath } = credentials;
  const result = spawnSync(process.execPath, [join(workerRoot, "node_modules", "wrangler", "bin", "wrangler.js"), "deploy", "--config", wranglerPath], {
    cwd: output,
    env: {
      ...baseEnv(),
      CLOUDFLARE_API_TOKEN: token,
      CLOUDFLARE_ACCOUNT_ID: config.cloudflareAccountId,
      XDG_CONFIG_HOME: join(output, "wrangler-home"),
      WRANGLER_SEND_METRICS: "false",
      WRANGLER_WRITE_LOGS: "false",
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
      CI: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  requireThat(result.status === 0, "本番Worker deployに失敗しました。Wrangler応答は秘密保護のため非表示です。変更状況は管理画面で確認してください。");
  // Official Wrangler deploy inherits existing secret bindings; never read or PUT their values.
  const bindings = await cloudflare(token, `${accountPath}/workers/scripts/${workerName}/secrets`);
  requireThat(Array.isArray(bindings) && bindings.some((binding) => binding.name === "TRACE_EDGE_SHARED_SECRET" && binding.type === "secret_text"),
    "配備後のEdge bindingを確認できません。成功とは扱いません。担当者がWorkerの状態を確認してください。");
  console.log(`本番Workerを配備しました: ${config.origin}（参加受付の承認・有効化は別操作です）。`);
}

try {
  const { command, config, digest } = publicConfig();
  if (command === "build") build(config, digest);
  else {
    const credentials = await validate(config, digest);
    if (command === "deploy") await deploy(config, credentials);
    else console.log("本番成果物・固定設定・Cloudflare account/subdomain・既存Edge bindingを確認しました。リモート変更・公開は実行していません。");
  }
} catch (error) {
  console.error(error instanceof ProductionError ? error.message : "本番処理に失敗しました。入力・依存package・成果物を確認してください。詳細は秘密保護のため出力しません。");
  process.exitCode = 1;
}
