import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { test } from "node:test";
import { MIN_LEFT_MS, PROOF_PATH, createIssuer, readConfig, sign } from "../issuer-core.mjs";

const issuerKey = "issuer-key-for-tests-0123456789abcdef";
const edgeSecret = "edge-secret-for-tests-0123456789abcd";
const display = "https://trace-log.example.test";

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (response) => {
      let text = "";
      response.on("data", (chunk) => (text += chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null }));
    });
    request.on("error", reject);
    request.end();
  });
}

/** A stand-in for TRACE_B's operator route that checks the request the way server.go does. */
async function fakeTraceB(state) {
  return listen((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      state.calls.push({ method: request.method, url: request.url, headers: request.headers, body });
      const timestamp = request.headers["x-trace-issuer-timestamp"];
      const valid = request.method === "POST" && request.url === PROOF_PATH && body === "" &&
        !request.headers.origin && request.headers["x-trace-edge-secret"] === edgeSecret &&
        request.headers["x-trace-issuer-signature"] === sign(issuerKey, "POST", PROOF_PATH, timestamp);
      if (state.reply) return state.reply(response);
      if (!valid) {
        response.writeHead(403, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: { code: "FORBIDDEN" } }));
      }
      state.issued += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ checkpointToken: `payload${state.issued}.signature`, expiresAt: new Date(state.now() + 25_000).toISOString() }));
    });
  });
}

function config(origin, overrides = {}) {
  return readConfig({ TRACE_API_ORIGIN: origin, TRACE_ARRIVAL_ISSUER_KEY: issuerKey, TRACE_EDGE_SHARED_SECRET: edgeSecret, DISPLAY_ORIGINS: display, ...overrides });
}

test("signs like TRACE_B: unpadded base64url HMAC-SHA256 over method, path and Unix seconds", () => {
  // Computed separately with Python's hmac module.
  assert.equal(sign(issuerKey, "POST", PROOF_PATH, "1761400000"), "8VZLMCTE0JUMgz2Vxsw3hJU7fFnR4zhymnKZf8WJsnA");
});

test("refuses settings that would leak the key or never work", () => {
  const base = { TRACE_API_ORIGIN: "https://api.example.test", TRACE_ARRIVAL_ISSUER_KEY: issuerKey };
  assert.equal(readConfig(base).refreshMs, 15_000);
  assert.equal(readConfig(base).port, 8790);
  assert.equal(readConfig({ ...base, TRACE_API_ORIGIN: "http://localhost:8080" }).origin, "http://localhost:8080");
  for (const bad of [
    { TRACE_API_ORIGIN: "http://api.example.test" },
    { TRACE_API_ORIGIN: "https://api.example.test/v1" },
    { TRACE_API_ORIGIN: "" },
    { TRACE_ARRIVAL_ISSUER_KEY: "short" },
    { DISPLAY_ORIGINS: "https://trace-log.example.test/display" },
    { REFRESH_SECONDS: "25" },
    { ISSUER_PORT: "80" },
  ]) {
    assert.throws(() => readConfig({ ...base, ...bad }), undefined, JSON.stringify(bad));
  }
});

test("gets a signed token from TRACE_B and hands it only to the allowed display origin", async () => {
  let clock = Date.parse("2026-10-31T01:00:00Z");
  const state = { calls: [], issued: 0, now: () => clock };
  const traceB = await fakeTraceB(state);
  const issuer = createIssuer(config(`http://127.0.0.1:${traceB.address().port}`), { now: () => clock });
  const local = await listen(issuer.handle);
  const port = local.address().port;
  try {
    assert.equal(await issuer.refresh(), 15_000);
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].headers.origin, undefined);
    assert.equal(issuer.status().lastError, "");

    const allowed = await get(port, "/arrival-token", { Origin: display });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.checkpointToken, "payload1.signature");
    assert.equal(allowed.headers["access-control-allow-origin"], display);
    assert.equal(allowed.headers["cache-control"], "no-store");
    assert.equal(Date.parse(allowed.body.nextAt), clock + 15_000);

    assert.equal((await get(port, "/arrival-token")).status, 200);
    assert.equal((await get(port, "/arrival-token", { Origin: "https://other.example.test" })).status, 403);
    assert.equal((await get(port, "/arrival-token", { Host: "rebound.example.test" })).status, 403);
    assert.equal((await get(port, "/elsewhere")).status, 404);

    // A token about to expire is no longer handed out.
    clock += 25_000 - MIN_LEFT_MS + 1;
    assert.equal((await get(port, "/arrival-token")).status, 503);
  } finally {
    traceB.close();
    local.close();
  }
});

test("keeps the last token while TRACE_B fails, and waits longer when rate limited", async () => {
  let clock = Date.parse("2026-10-31T01:00:00Z");
  const state = { calls: [], issued: 0, now: () => clock };
  const traceB = await fakeTraceB(state);
  const issuer = createIssuer(config(`http://127.0.0.1:${traceB.address().port}`), { now: () => clock });
  try {
    await issuer.refresh();
    state.reply = (response) => {
      response.writeHead(429, { "Content-Type": "application/json", "Retry-After": "30" });
      response.end(JSON.stringify({ error: { code: "RATE_LIMITED" } }));
    };
    clock += 15_000;
    assert.equal(await issuer.refresh(), 30_000);
    assert.match(issuer.status().lastError, /429 RATE_LIMITED/);
    assert.equal(issuer.current()?.checkpointToken, "payload1.signature");

    state.reply = (response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ expiresAt: "soon" }));
    };
    await issuer.refresh();
    assert.match(issuer.status().lastError, /checkpointToken/);
    clock += 10_000 - MIN_LEFT_MS + 1;
    assert.equal(issuer.current(), null);
  } finally {
    traceB.close();
  }
});

test("a wrong key gets TRACE_B's 403 and no token", async () => {
  const clock = Date.now();
  const state = { calls: [], issued: 0, now: () => clock };
  const traceB = await fakeTraceB(state);
  const issuer = createIssuer(config(`http://127.0.0.1:${traceB.address().port}`, { TRACE_ARRIVAL_ISSUER_KEY: "another-issuer-key-0123456789abcdefgh" }), { now: () => clock });
  try {
    await issuer.refresh();
    assert.match(issuer.status().lastError, /403 FORBIDDEN/);
    assert.equal(issuer.current(), null);
  } finally {
    traceB.close();
  }
});
