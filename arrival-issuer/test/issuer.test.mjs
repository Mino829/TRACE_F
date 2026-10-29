import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { test } from "node:test";
import { CREDENTIAL_PATH, PROOF_PATH, createIssuer, readConfig } from "../issuer-core.mjs";

const edgeSecret = "server-held-edge-secret";
const display = "https://trace-log.example.test";
const google = "google.identity.jwt";

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function call(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}`, Origin: display, ...headers } }, (response) => {
      let text = "";
      response.on("data", (chunk) => (text += chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: text ? JSON.parse(text) : null }));
    });
    request.on("error", reject);
    request.end(body);
  });
}
function config(origin, overrides = {}) {
  return readConfig({ TRACE_API_ORIGIN: origin, TRACE_EDGE_SHARED_SECRET: edgeSecret, DISPLAY_ORIGINS: display, ...overrides });
}

async function setup(t, upstreamHandler) {
  const upstream = await listen(upstreamHandler);
  const broker = createIssuer(config(`http://127.0.0.1:${upstream.address().port}`));
  const local = await listen(broker.handle);
  t.after(() => { upstream.closeAllConnections(); upstream.close(); local.closeAllConnections(); local.close(); });
  return local.address().port;
}

// A stateful authority exercises bearer purpose and revocation through actual HTTP,
// rather than returning copied request fields as a successful operation.
function authority() {
  const credentials = new Set();
  let proofs = 0;
  let calls = 0;
  return {
    get calls() { return calls; },
    handler(request, response) {
      calls++;
      const reply = (status, body) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(body ? JSON.stringify(body) : undefined); };
      if (request.headers["x-trace-edge-secret"] !== edgeSecret || request.headers.origin !== display) return reply(403, { error: { code: "FORBIDDEN" } });
      const bearer = request.headers.authorization;
      if (request.method === "POST" && request.url === CREDENTIAL_PATH) {
        if (bearer !== `Bearer ${google}`) return reply(401, { error: { code: "UNAUTHORIZED" } });
        const token = `opaque-${credentials.size + 1}-${calls}`;
        credentials.add(`Bearer ${token}`);
        return reply(200, { operatorToken: token, credentialId: `credential-${calls}`, expiresAt: new Date(Date.now() + 120000).toISOString(), role: "operator" });
      }
      if (!credentials.has(bearer)) return reply(401, { error: { code: "UNAUTHORIZED" } });
      if (request.method === "DELETE") {
        if (request.url === CREDENTIAL_PATH) credentials.clear();
        else if (request.url === `${CREDENTIAL_PATH}/current`) credentials.delete(bearer);
        else return reply(404);
        return reply(204);
      }
      if (request.method === "POST" && request.url === PROOF_PATH) return reply(200, { checkpointToken: `proof-${++proofs}.signature`, expiresAt: new Date(Date.now() + 25000).toISOString() });
      return reply(404);
    },
  };
}

test("refuses unsafe origins and missing explicit browser allowlist", () => {
  const base = { TRACE_API_ORIGIN: "https://api.example.test", DISPLAY_ORIGINS: display };
  for (const bad of [{ TRACE_API_ORIGIN: "http://api.example.test" }, { TRACE_API_ORIGIN: "https://api.example.test/v1" }, { TRACE_API_ORIGIN: "https://user:pass@api.example.test" }, { DISPLAY_ORIGINS: "" }, { DISPLAY_ORIGINS: `${display}/display` }, { DISPLAY_ORIGINS: "http://public.example.test" }, { ISSUER_PORT: "80" }]) {
    assert.throws(() => readConfig({ ...base, ...bad }));
  }
});

test("separate Google issuance and opaque operations; current/all revocation enforce subsequent denial", async (t) => {
  const auth = authority();
  const port = await setup(t, auth.handler);
  assert.equal(auth.calls, 0); // Starting the broker never mints QR codes.
  const login = () => call(port, "/operator/credentials", { method: "POST", headers: { Authorization: `Bearer ${google}` } });
  const first = await login();
  const second = await login();
  assert.equal(first.status, 200);
  assert.notEqual(first.body.operatorToken, second.body.operatorToken);
  assert.equal(JSON.stringify(first.body).includes(edgeSecret), false);
  for (const token of [google, "renderer-token", "participant-token"]) {
    assert.equal((await call(port, "/arrival-token", { headers: { Authorization: `Bearer ${token}` } })).status, 401);
  }
  const one = { Authorization: `Bearer ${first.body.operatorToken}` };
  const two = { Authorization: `Bearer ${second.body.operatorToken}` };
  const qr1 = await call(port, "/arrival-token", { headers: one });
  const qr2 = await call(port, "/arrival-token", { headers: two });
  assert.equal(qr1.status, 200);
  assert.notEqual(qr1.body.checkpointToken, qr2.body.checkpointToken); // no global QR cache
  assert.equal(qr1.headers["cache-control"], "no-store");
  assert.equal((await call(port, "/operator/credentials/current", { method: "DELETE", headers: one })).status, 204);
  assert.equal((await call(port, "/arrival-token", { headers: one })).status, 401);
  assert.equal((await call(port, "/arrival-token", { headers: two })).status, 200);
  const third = await login();
  assert.equal((await call(port, "/operator/credentials", { method: "DELETE", headers: two })).status, 204);
  assert.equal((await call(port, "/arrival-token", { headers: { Authorization: `Bearer ${third.body.operatorToken}` } })).status, 401);
});

test("rejects missing/duplicate identity headers, rebinding, bodies, query and disallowed preflights before forwarding", async (t) => {
  const auth = authority();
  const port = await setup(t, auth.handler);
  const cases = [
    ["/arrival-token", {}, 401],
    ["/arrival-token", { headers: { Origin: "" } }, 403],
    ["/arrival-token", { headers: { Origin: "https://evil.example.test" } }, 403],
    ["/arrival-token", { headers: { Host: "rebound.example.test" } }, 403],
    ["/arrival-token", { headers: { Authorization: ["Bearer a", "Bearer b"] } }, 401],
    ["/operator/credentials", { method: "POST", headers: { Authorization: `Bearer ${google}`, "Content-Length": "1" }, body: "x" }, 400],
    ["/arrival-token?target=https://evil.example.test", {}, 404],
    ["/arrival-token", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "X-Trace-Edge-Secret" } }, 403],
  ];
  for (const [path, options, status] of cases) assert.equal((await call(port, path, options)).status, status);
  assert.equal(auth.calls, 0);
  const preflight = await call(port, "/operator/credentials", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization" } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], display);
});

test("never follows a redirect with bearer or Edge secret", async (t) => {
  let leaked = false;
  const sink = await listen((_request, response) => { leaked = true; response.end(); });
  t.after(() => { sink.closeAllConnections(); sink.close(); });
  const port = await setup(t, (_request, response) => { response.writeHead(307, { Location: `http://127.0.0.1:${sink.address().port}/stolen` }); response.end(); });
  const result = await call(port, "/arrival-token", { headers: { Authorization: "Bearer opaque" } });
  assert.equal(result.status, 502);
  assert.equal(leaked, false);
  assert.equal(JSON.stringify(result.body).includes(edgeSecret), false);
});

test("upstream denial and rate limits are not replaced by a cached successful QR", async (t) => {
  let status = 429;
  const port = await setup(t, (_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json", "Retry-After": "30" });
    response.end(JSON.stringify({ error: { code: status === 429 ? "RATE_LIMITED" : "UNAUTHORIZED" } }));
  });
  const limited = await call(port, "/arrival-token", { headers: { Authorization: "Bearer opaque" } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], "30");
  status = 401;
  assert.equal((await call(port, "/arrival-token", { headers: { Authorization: "Bearer opaque" } })).status, 401);
});

test("rejects fake-success revocations and malformed or already expired proof responses", async (t) => {
  let mode = "revoke";
  const port = await setup(t, (_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(mode === "expired"
      ? { checkpointToken: "expired.signature", expiresAt: new Date(Date.now() - 1).toISOString() }
      : { ok: true }));
  });
  const headers = { Authorization: "Bearer opaque" };
  assert.equal((await call(port, "/operator/credentials/current", { method: "DELETE", headers })).status, 502);
  mode = "malformed";
  assert.equal((await call(port, "/arrival-token", { headers })).status, 502);
  mode = "expired";
  assert.equal((await call(port, "/arrival-token", { headers })).status, 502);
});
