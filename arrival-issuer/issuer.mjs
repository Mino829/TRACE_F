// Runs on the display PC for the whole opening time:
//
//   node arrival-issuer/issuer.mjs
//
// Reads arrival-issuer/.env, asks TRACE_B for an arrival QR token every
// REFRESH_SECONDS and serves the current one at http://127.0.0.1:<port>/arrival-token.

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createIssuer, readConfig } from "./issuer-core.mjs";

const envFile = join(dirname(fileURLToPath(import.meta.url)), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

let config;
try {
  config = readConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const issuer = createIssuer(config);
const server = createServer(issuer.handle);
server.on("error", (error) => {
  console.error(`ポート ${config.port} を開けませんでした: ${error.message}`);
  process.exit(1);
});
server.listen(config.port, "127.0.0.1", () => {
  console.log(`到着トークンを http://127.0.0.1:${config.port}/arrival-token で渡します。`);
  console.log("止めるときは Ctrl+C を押してください。");
});

let timer;
let failing = false;
async function loop() {
  const wait = await issuer.refresh();
  const { lastError } = issuer.status();
  // Logs only changes, never the token or the keys.
  if (lastError) console.error(`${new Date().toLocaleTimeString()} トークンを取れませんでした: ${lastError}`);
  else if (failing) console.log(`${new Date().toLocaleTimeString()} トークンを取れるようになりました。`);
  failing = Boolean(lastError);
  timer = setTimeout(loop, wait);
}
loop();

process.on("SIGINT", () => {
  clearTimeout(timer);
  server.close(() => process.exit(0));
});
