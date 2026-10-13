import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSiteRequest } from "../src/site.ts";

const env = {
  TRACE_BACKEND_URL: "https://go.example.test",
  TRACE_EDGE_SHARED_SECRET: "a-32-byte-secret-for-cloudflare-edge",
  ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
};
const site = "https://trace.example.test";

test("serves non-API assets without backend configuration", async () => {
  const response = await handleSiteRequest(new Request(`${site}/log`), { ...env, TRACE_BACKEND_URL: "" });
  assert.equal(await response.text(), "asset");
});

test("allows only participant API paths and forwards credentials without URL leakage", async () => {
  let forwarded;
  const request = new Request(`${site}/api/backend/v1/live-presence-sessions/live_abc/position`, {
    method: "POST",
    headers: { "Origin": site, "Content-Type": "application/json", "Authorization": "Bearer participant", "X-Untrusted": "discard" },
    body: JSON.stringify({ point: { latitude: 35 } }),
  });
  const response = await handleSiteRequest(request, env, async (upstream) => {
    forwarded = upstream;
    return Response.json({ ok: true }, { headers: { "X-Request-ID": "req-1", "Set-Cookie": "private=1" } });
  });
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, "https://go.example.test/v1/live-presence-sessions/live_abc/position");
  assert.equal(forwarded.headers.get("Authorization"), "Bearer participant");
  assert.equal(forwarded.headers.get("X-Trace-Edge-Secret"), env.TRACE_EDGE_SHARED_SECRET);
  assert.equal(forwarded.headers.get("X-Untrusted"), null);
  assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Request-ID"), "req-1");
});

test("rejects unexpected requests before calling the backend", async () => {
  const noCall = async () => { throw new Error("backend called"); };
  const cases = [
    [new Request(`${site}/api/backend/v1/admin`), 404],
    [new Request(`${site}/api/backend/v1/public/config?token=leak`), 404],
    [new Request(`${site}/api/backend/v1/experiences`, { method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" }, body: "{}" }), 403],
    [new Request(`${site}/api/backend/v1/experiences`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" }), 415],
    [new Request(`${site}/api/backend/v1/experiences`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(16385) }), 413],
  ];
  for (const [request, expected] of cases) {
    const response = await handleSiteRequest(request, env, noCall);
    assert.equal(response.status, expected);
  }
});

test("fails closed when backend secret is missing or backend redirects", async () => {
  const request = new Request(`${site}/api/backend/v1/public/config`);
  assert.equal((await handleSiteRequest(request, { ...env, TRACE_EDGE_SHARED_SECRET: "" })).status, 503);
  const response = await handleSiteRequest(request, env, async () => new Response(null, { status: 302, headers: { Location: "https://other.example" } }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Location"), null);
});
