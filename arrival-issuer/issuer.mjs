// Runs on the display PC for the whole opening time:
//
//   node arrival-issuer/issuer.mjs
//
// Reads arrival-issuer/.env and forwards authenticated browser requests.
// There is no background minting or shared QR cache.

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


process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
