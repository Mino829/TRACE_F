import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnvFile } from "node:process";

const root = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(path.join(root, ".env.local"))) loadEnvFile(path.join(root, ".env.local"));
const backendRepo = path.resolve(process.env.TRACE_BACKEND_REPO ?? path.join(root, "../trace_Backend"));
const local = path.join(root, ".local");
const dbDir = path.join(local, "postgres");
const dbPort = 55432;
const apiPort = 8080;
const children = [];
let databaseStarted = false;
let ending = false;

function execute(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `${command} failed (${result.status})`);
}

function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Port ${port} is in use. Stop the previous local server first.`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.push(child);
  child.once("error", (error) => { console.error(error.message); void finish(1); });
  child.once("exit", (code) => { if (!ending) void finish(code ?? 1); });
  return child;
}

async function finish(code = 0) {
  if (ending) return;
  ending = true;
  const exits = children.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) return resolve();
    child.once("exit", resolve);
    child.kill("SIGTERM");
  }));
  await Promise.race([Promise.all(exits), new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (databaseStarted) spawnSync("pg_ctl", ["-D", dbDir, "-m", "fast", "stop"], { stdio: "inherit" });
  process.exit(code);
}

process.on("SIGINT", () => { void finish(); });
process.on("SIGTERM", () => { void finish(); });

try {
  if (!existsSync(path.join(backendRepo, "go.mod"))) throw new Error("Set TRACE_BACKEND_REPO to the trace_Backend repository.");
  for (const binary of ["go", "initdb", "pg_ctl", "psql", "createdb"]) {
    const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
    if (result.error) throw new Error(`Install ${binary} before running dev:local.`);
  }
  await Promise.all([freePort(3000), freePort(apiPort), freePort(dbPort)]);
  mkdirSync(local, { recursive: true });
  if (!existsSync(path.join(dbDir, "PG_VERSION"))) {
    execute("initdb", ["-D", dbDir, "-U", "trace_local", "-A", "trust", "--no-locale", "-E", "UTF8"]);
  }
  const databaseVersion = spawnSync("postgres", ["--version"], { encoding: "utf8" });
  if (databaseVersion.error) throw new Error("PostgreSQL is required.");
  execute("pg_ctl", ["-D", dbDir, "-l", path.join(local, "postgres.log"), "-o",
    `-h 127.0.0.1 -p ${dbPort} -k ${local}`, "start"]);
  databaseStarted = true;
  const query = spawnSync("psql", ["-h", "127.0.0.1", "-p", String(dbPort), "-U", "trace_local", "-d", "postgres", "-Atc",
    "SELECT 1 FROM pg_database WHERE datname='trace'"], { encoding: "utf8" });
  if (query.status !== 0) throw new Error("Cannot connect to the local database.");
  if (query.stdout.trim() !== "1") execute("createdb", ["-h", "127.0.0.1", "-p", String(dbPort), "-U", "trace_local", "trace"]);
  const binary = path.join(local, "trace-backend");
  execute("go", ["build", "-o", binary, "./cmd/server"], { cwd: backendRepo });
  const backendEnv = { ...process.env, DATABASE_URL: `postgresql://trace_local@127.0.0.1:${dbPort}/trace?sslmode=disable`,
    TRACE_ADDRESS: `127.0.0.1:${apiPort}`, TRACE_DATABASE_PATH: "", TRACE_EDGE_SHARED_SECRET: "" };
  execute(binary, ["migrate"], { env: backendEnv });
  start(binary, [], { env: backendEnv });
  let ready = false;
  for (let count = 0; count < 30; count++) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/health/ready`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error("The Go API did not become ready.");
  console.log("TRACE: http://localhost:3000 — Ctrl+C stops the app, API and local DB. Data stays in .local/postgres.");
  start(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--webpack", "--hostname", "127.0.0.1"], {
    cwd: root, env: { ...process.env, TRACE_BACKEND_URL: `http://127.0.0.1:${apiPort}` },
  });
} catch (error) {
  console.error(error.message);
  await finish(1);
}
