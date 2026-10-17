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

test("two-token delete forwards the live token only for the dedicated experience route", async () => {
  const headers = { Origin: site, Authorization: "Bearer memory-token", "X-Trace-Live-Token": "live-token", "Idempotency-Key": "same-key" };
  const requests = [];
  for (const path of ["v1/experiences/exp_abc", "v1/memory-sessions/mem_abc"]) {
    const response = await handleSiteRequest(new Request(`${site}/api/backend/${path}`, {
      method: "DELETE", headers,
    }), env, async (upstream) => {
      requests.push(upstream);
      return new Response(path.startsWith("v1/experiences/") ? JSON.stringify({
        memory: "deleted", live: "pending", complete: false,
      }) : null, { status: path.startsWith("v1/experiences/") ? 200 : 204 });
    });
    assert.equal(response.status, path.startsWith("v1/experiences/") ? 200 : 204);
    if (response.status === 200) assert.deepEqual(await response.json(), { memory: "deleted", live: "pending", complete: false });
  }
  assert.equal(requests[0].headers.get("X-Trace-Live-Token"), "live-token");
  assert.equal(requests[1].headers.get("X-Trace-Live-Token"), null);
  assert.equal(requests[0].headers.get("Authorization"), "Bearer memory-token");
  assert.equal(requests[0].headers.get("Idempotency-Key"), "same-key");
});

test("forwards only the Cloudflare client IP, never browser-supplied forwarding headers", async () => {
  const cases = [
    ["203.0.113.42", "203.0.113.42"],
    ["2001:db8::42", "2001:db8::42"],
    [null, null],
    ["", null],
    ["203.0.113.42, 198.51.100.7", null],
    ["010.0.0.1", null],
    ["256.0.0.1", null],
    ["2001:DB8::42", null],
    ["2001:db8::42%eth0", null],
  ];
  for (const [cloudflareIP, expected] of cases) {
    const headers = new Headers({
      "X-Forwarded-For": "198.51.100.21",
      "X-Trace-Client-IP": "198.51.100.22",
      "X-Trace-Edge-Secret": "browser-secret",
    });
    if (cloudflareIP !== null) headers.set("CF-Connecting-IP", cloudflareIP);
    const request = new Request(`${site}/api/backend/v1/public/config`, { headers });
    let forwarded;
    await handleSiteRequest(request, env, async (upstream) => {
      forwarded = upstream;
      return Response.json({});
    });
    assert.equal(forwarded.headers.get("X-Trace-Client-IP"), expected, `CF-Connecting-IP: ${cloudflareIP}`);
    assert.equal(forwarded.headers.get("X-Forwarded-For"), null);
    assert.equal(forwarded.headers.get("CF-Connecting-IP"), null);
    assert.equal(forwarded.headers.get("X-Trace-Edge-Secret"), env.TRACE_EDGE_SHARED_SECRET);
    assert.equal([...forwarded.headers.keys()].filter((name) => name === "x-trace-client-ip").length, expected ? 1 : 0);
  }
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
