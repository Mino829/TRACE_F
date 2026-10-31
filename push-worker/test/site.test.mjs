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
  const request = new Request(`${site}/api/backend/v1/live-presence-sessions/live_abc/stop`, {
    method: "POST",
    headers: { "Origin": site, "Content-Type": "application/json", "Authorization": "Bearer participant", "X-Untrusted": "discard" },
    body: JSON.stringify({}),
  });
  const response = await handleSiteRequest(request, env, async (upstream) => {
    forwarded = upstream;
    return Response.json({ ok: true }, { headers: { "X-Request-ID": "req-1", "Set-Cookie": "private=1" } });
  });
  assert.equal(response.status, 200);
  assert.equal(forwarded.url, "https://go.example.test/v1/live-presence-sessions/live_abc/stop");
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

test("DELETE accepts empty streams but rejects any actual body bytes", async () => {
  const cases = [
    { name: "closed empty stream", chunks: [], expected: 204 },
    { name: "zero-length chunks", chunks: [new Uint8Array(0), new Uint8Array(0)], expected: 204 },
    { name: "one byte", chunks: [new Uint8Array([1])], expected: 400 },
    { name: "one byte after empty chunk", chunks: [new Uint8Array(0), new Uint8Array([1])], expected: 400 },
  ];
  for (const { name, chunks, expected } of cases) {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request(`${site}/api/backend/v1/memory-sessions/mem_abc`, {
      method: "DELETE",
      headers: { Origin: site, Authorization: "Bearer owner", "Idempotency-Key": "delete-key" },
      body: stream,
      duplex: "half",
    });
    const response = await handleSiteRequest(request, env, async () => new Response(null, { status: 204 }));
    assert.equal(response.status, expected, name);
    if (expected === 400) assert.equal((await response.json()).error.code, "BODY_NOT_ALLOWED");
  }
});

test("relays the arrival, reminder, photo place and photo-delete routes with their bodies", async () => {
  const memory = "v1/memory-sessions/mem_abc";
  const moments = "v2/memory-sessions/mem_abc/photos";
  const subscription = JSON.stringify({ consent: true, subscription: { endpoint: "https://push.example.test/1", keys: { p256dh: "k", auth: "a" } }, intervalMinutes: 30 });
  const cases = [
    ["POST", `${memory}/arrival`, JSON.stringify({ checkpointToken: "token" })],
    ["POST", `${memory}/arrival/skip`, ""],
    ["PUT", `${memory}/push-subscription`, subscription],
    ["PATCH", `${memory}/push-subscription`, JSON.stringify({ status: "paused" })],
    ["DELETE", `${memory}/photos/photo_xyz`],
    ["DELETE", `${memory}/push-subscription`],
    ["POST", moments, JSON.stringify({ clientPhotoId: "photo-1", checkpointId: "cp_kyoshitsu_3f_301", capturedAt: "2026-10-31T01:00:00.000Z" })],
    ["DELETE", `${moments}/photo_xyz`],
  ];
  for (const [method, path, body] of cases) {
    const headers = { Origin: site, Authorization: "Bearer memory-token", "Idempotency-Key": "key-1" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let forwarded;
    let forwardedBody;
    const response = await handleSiteRequest(new Request(`${site}/api/backend/${path}`, { method, headers, body: body || undefined }), env, async (upstream) => {
      forwarded = upstream;
      forwardedBody = await upstream.text();
      return new Response(null, { status: 204 });
    });
    assert.equal(response.status, 204, `${method} ${path}`);
    assert.equal(forwarded.method, method);
    assert.equal(forwarded.url, `https://go.example.test/${path}`);
    assert.equal(forwarded.headers.get("Authorization"), "Bearer memory-token");
    assert.equal(forwarded.headers.get("Idempotency-Key"), "key-1");
    assert.equal(forwardedBody, body ?? "", `${method} ${path}`);
  }
});

test("keeps operator and display routes closed", async () => {
  const noCall = async () => { throw new Error("backend called"); };
  const json = { Origin: site, "Content-Type": "application/json" };
  const cases = [
    new Request(`${site}/api/backend/v1/operator/arrival-proofs`, { method: "POST", headers: json, body: "" }),
    new Request(`${site}/api/backend/v1/operator/display-tokens`, { method: "POST", headers: json, body: "" }),
    new Request(`${site}/api/backend/v1/operator/arrivals`),
    new Request(`${site}/api/backend/v1/display/ws`),
    new Request(`${site}/api/backend/v1/memory-sessions/mem_abc/photos/abc/complete`, { method: "POST", headers: json }),
    // Legacy cloud uploads and new GPS writes stay blocked; owner reads remain available.
    new Request(`${site}/api/backend/v1/memory-sessions/mem_abc/photos`, { method: "POST", headers: json, body: "{}" }),
    new Request(`${site}/api/backend/v1/memory-sessions/mem_abc/photos/photo_xyz/upload-url`, { method: "POST", headers: json, body: "" }),
    new Request(`${site}/api/backend/v1/memory-sessions/mem_abc/photos/photo_xyz/complete`, { method: "POST", headers: json, body: "" }),
    new Request(`${site}/api/backend/v1/live-presence-sessions/live_abc/position`, { method: "POST", headers: json, body: "{}" }),
    new Request(`${site}/api/backend/v1/memory-sessions/mem_abc/photos`, { method: "PUT", headers: json, body: "{}" }),
    new Request(`${site}/api/backend/v1/experiences/exp_abc`, { method: "PATCH", headers: json, body: "{}" }),
    new Request(`${site}/api/backend/v2/memory-sessions/mem_abc/photos/photo_xyz`, { method: "POST", headers: json, body: "{}" }),
    new Request(`${site}/api/backend/v2/memory-sessions/mem_abc/photos/other_xyz`, { method: "DELETE", headers: { Origin: site } }),
  ];
  for (const request of cases) {
    const response = await handleSiteRequest(request, env, noCall);
    assert.equal(response.status, 404, `${request.method} ${new URL(request.url).pathname}`);
  }
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
    [new Request(`${site}/api/backend/v1/memory-sessions/mem_abc/push-subscription`, { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "{}" }), 415],
    [new Request(`${site}/api/backend/v1/memory-sessions/mem_abc/push-subscription`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "x".repeat(16385) }), 413],
    [new Request(`${site}/api/backend/v1/memory-sessions/mem_abc/arrival/skip`, { method: "POST", headers: { Origin: "https://other.example", "Content-Type": "application/json" } }), 403],
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

const operatorEnv = { ...env, TRACE_OPERATOR_ALLOWED_ORIGIN: site };
const credentialPath = "/operator/credentials";
const currentCredentialPath = "/operator/credentials/current";

function operatorRequest(path = "/arrival-token", init = {}) {
  return new Request(`${site}/api/operator${path}`, {
    ...init,
    headers: { Origin: site, Authorization: "Bearer operator-credential", ...init.headers },
  });
}

function assertPrivateBridgeResponse(response) {
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  for (const header of ["Set-Cookie", "Access-Control-Allow-Origin", "Access-Control-Allow-Credentials", "X-Trace-Edge-Secret", "Location", "X-Request-ID"]) {
    assert.equal(response.headers.get(header), null, header);
  }
}

test("hosted operator bridge is closed without an exact HTTPS origin opt-in", async () => {
  let calls = 0;
  const upstream = async () => { calls++; return Response.json({}); };
  for (const binding of [undefined, "", `${site}/`, "https://other.example.test", "*", "null", "http://trace.example.test", `${site},https://other.example.test`]) {
    for (const [method, path] of [["GET", "/arrival-token"], ["POST", credentialPath], ["DELETE", currentCredentialPath], ["DELETE", credentialPath]]) {
      const response = await handleSiteRequest(operatorRequest(path, { method }), { ...env, TRACE_OPERATOR_ALLOWED_ORIGIN: binding }, upstream);
      assert.equal(response.status, 404, `${binding}: ${method} ${path}`);
      assert.deepEqual(await response.json(), { error: { code: "NOT_FOUND" } });
      assertPrivateBridgeResponse(response);
    }
  }
  const insecure = await handleSiteRequest(new Request("http://trace.example.test/api/operator/arrival-token"), {
    ...env, TRACE_OPERATOR_ALLOWED_ORIGIN: "http://trace.example.test",
  }, upstream);
  assert.equal(insecure.status, 404);
  assert.equal(calls, 0);
});

test("only four hosted routes exist and backend operator/admin routes remain closed even when enabled", async () => {
  let calls = 0;
  const cases = [
    ["GET", "/api/operator"],
    ["GET", "/api/operator/"],
    ["GET", "/api/operator/health"],
    ["GET", "/api/operator/operator/credentials"],
    ["POST", "/api/operator/arrival-token"],
    ["OPTIONS", "/api/operator/operator/credentials"],
    ["HEAD", "/api/operator/arrival-token"],
    ["POST", "/api/operator/operator/display-tokens"],
    ["GET", "/api/operator/operator/arrivals"],
    ["POST", "/api/operator/operator/arrivals/id/stop"],
    ["POST", "/api/operator/operator/arrivals/id/fallback"],
    ["POST", "/api/operator/operator/arrivals/id/retry"],
    ["POST", "/api/operator/operator/arrivals/id/skip"],
    ["GET", "/api/operator/display/ws"],
    ["GET", "/api/operator/arrival-token/"],
    ["GET", "/api/operator/%61rrival-token"],
    ["GET", "/api/operator/arrival-token?token=private"],
    ["GET", "/api/operator/arrival-token?"],
    ["GET", "/api/operator/arrival-token#private"],
    ["GET", "/api/operator/arrival-token#"],
    ["POST", "/api/backend/v1/operator/credentials"],
    ["DELETE", "/api/backend/v1/operator/credentials"],
    ["POST", "/api/backend/v1/operator/arrival-proofs"],
    ["POST", "/api/backend/v1/operator/display-tokens"],
    ["GET", "/api/backend/v1/display/ws"],
  ];
  for (const [method, path] of cases) {
    const response = await handleSiteRequest(new Request(`${site}${path}`, {
      method, headers: { Origin: site, Authorization: "Bearer operator-credential" },
    }), operatorEnv, async () => { calls++; return Response.json({}); });
    assert.equal(response.status, 404, `${method} ${path}`);
    assertPrivateBridgeResponse(response);
  }
  assert.equal(calls, 0);
});

test("hosted authentication syntax and Origin failures never reach Go", async () => {
  let calls = 0;
  const upstream = async () => { calls++; return Response.json({}); };
  for (const authorization of [null, "", "Basic token", "Bearer", "Bearer ", "bearer token", "Bearer token token", "Bearer token,Bearer other", "Bearer token, Bearer other", "Bearer token/unsafe", "Bearer token=unsafe"]) {
    const request = operatorRequest();
    if (authorization === null) request.headers.delete("Authorization");
    else request.headers.set("Authorization", authorization);
    const response = await handleSiteRequest(request, operatorEnv, upstream);
    assert.equal(response.status, 401, String(authorization));
    assert.deepEqual(await response.json(), { error: { code: "UNAUTHORIZED" } });
    assertPrivateBridgeResponse(response);
  }
  const duplicate = operatorRequest();
  duplicate.headers.append("Authorization", "Bearer second");
  assert.equal((await handleSiteRequest(duplicate, operatorEnv, upstream)).status, 401);
  for (const [method, path] of [["GET", "/arrival-token"], ["POST", credentialPath], ["DELETE", currentCredentialPath], ["DELETE", credentialPath]]) {
    for (const origin of ["https://other.example.test", "null", `${site}/`, `${site}, ${site}`, "", null]) {
      const request = operatorRequest(path, { method, headers: { "Sec-Fetch-Site": "same-origin" } });
      if (origin === null) request.headers.delete("Origin");
      else request.headers.set("Origin", origin);
      if (method === "GET" && origin === null) request.headers.set("Sec-Fetch-Site", "cross-site");
      const response = await handleSiteRequest(request, operatorEnv, upstream);
      assert.equal(response.status, 403, `${method}: ${origin}`);
      assertPrivateBridgeResponse(response);
    }
  }
  for (const fetchSite of [null, "none", "same-site", "cross-site", "same-origin, same-origin"]) {
    const request = operatorRequest();
    request.headers.delete("Origin");
    if (fetchSite !== null) request.headers.set("Sec-Fetch-Site", fetchSite);
    assert.equal((await handleSiteRequest(request, operatorEnv, upstream)).status, 403);
  }
  assert.equal(calls, 0);
});

test("all hosted routes inspect actual body bytes, reject body metadata, and accept empty streams", async () => {
  for (const [method, path] of [["GET", "/arrival-token"], ["POST", credentialPath], ["DELETE", currentCredentialPath], ["DELETE", credentialPath]]) {
    for (const chunks of [[], [new Uint8Array(0)], [new Uint8Array(0), new Uint8Array([1])], [new TextEncoder().encode("{}")]]) {
      let calls = 0;
      const request = operatorRequest(path, {
        method: method === "GET" ? "POST" : method,
        body: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
        duplex: "half",
      });
      // Standard Node Request forbids GET bodies; Workers may expose an empty
      // stream for bodyless requests. Exercise the same byte boundary for GET.
      if (method === "GET") Object.defineProperty(request, "method", { value: "GET" });
      const response = await handleSiteRequest(request, operatorEnv, async () => {
        calls++;
        if (method === "DELETE") return new Response(null, { status: 204 });
        return Response.json(method === "GET"
          ? { checkpointToken: "proof", expiresAt: new Date(Date.now() + 60000).toISOString() }
          : { operatorToken: "opaque", credentialId: "credential-1", role: "operator", expiresAt: new Date(Date.now() + 60000).toISOString() });
      });
      const nonempty = chunks.some((chunk) => chunk.byteLength > 0);
      assert.equal(response.status, nonempty ? 400 : method === "DELETE" ? 204 : 200, `${method}: ${chunks.map((chunk) => chunk.byteLength)}`);
      assert.equal(calls, nonempty ? 0 : 1);
      assertPrivateBridgeResponse(response);
    }
    for (const headers of [{ "Content-Length": "1" }, { "Content-Length": "0, 0" }, { "Transfer-Encoding": "chunked" }]) {
      let calls = 0;
      const response = await handleSiteRequest(operatorRequest(path, { method, headers }), operatorEnv, async () => {
        calls++; return Response.json({});
      });
      assert.equal(response.status, 400);
      assert.equal(calls, 0);
    }
  }
  let calls = 0;
  const failedBody = operatorRequest(credentialPath, {
    method: "POST",
    body: new ReadableStream({ start(controller) { controller.error(new Error("private stream error")); } }),
    duplex: "half",
  });
  const response = await handleSiteRequest(failedBody, operatorEnv, async () => { calls++; return Response.json({}); });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: { code: "INVALID_REQUEST" } });
  assert.equal(calls, 0);
});

test("invalid hosted upstream configuration fails closed before network access", async () => {
  let calls = 0;
  for (const backend of ["", "not-a-url", "http://go.example.test", "https://go.example.test/private", "https://go.example.test?token=private", "https://go.example.test#private", "https://go.example.test?", "https://user:password@go.example.test", "https://GO.example.test", "https://go.example.test:443", " https://go.example.test"]) {
    const response = await handleSiteRequest(operatorRequest(), { ...operatorEnv, TRACE_BACKEND_URL: backend }, async () => {
      calls++; return Response.json({});
    });
    assert.equal(response.status, 503, backend);
    assertPrivateBridgeResponse(response);
  }
  for (const secret of ["", "invalid\nprivate-secret"]) {
    const response = await handleSiteRequest(operatorRequest(), { ...operatorEnv, TRACE_EDGE_SHARED_SECRET: secret }, async () => {
      calls++; return Response.json({});
    });
    assert.equal(response.status, 503);
    assertPrivateBridgeResponse(response);
  }
  assert.equal(calls, 0);
});

test("hosted consumer session authenticates with Go on every exchange and revocation takes effect", async () => {
  const active = new Set();
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  let exchanges = 0;
  const go = async (request) => {
    exchanges++;
    assert.equal(request.headers.get("Origin"), site);
    assert.equal(request.headers.get("X-Trace-Edge-Secret"), env.TRACE_EDGE_SHARED_SECRET);
    assert.equal(request.redirect, "manual");
    assert.ok(request.signal);
    assert.equal(await request.text(), "");
    const route = `${request.method} ${new URL(request.url).pathname}`;
    const token = request.headers.get("Authorization");
    if (route === "POST /v1/operator/credentials") {
      if (token !== "Bearer allowed-google-id-token") return Response.json({ error: { code: "OPERATOR_NOT_ALLOWED", email: "private@example.test" } }, { status: 403 });
      active.add("opaque-operator-token");
      return Response.json({ operatorToken: "opaque-operator-token", credentialId: "credential-1", expiresAt, role: "operator", edgeSecret: env.TRACE_EDGE_SHARED_SECRET, email: "private@example.test" });
    }
    if (!active.has(token?.slice("Bearer ".length))) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
    if (route === "POST /v1/operator/arrival-proofs") return Response.json({ checkpointToken: "signed-arrival-proof", expiresAt, privateClaims: { email: "private@example.test" } });
    assert.ok(["DELETE /v1/operator/credentials/current", "DELETE /v1/operator/credentials"].includes(route), route);
    active.clear();
    return new Response(null, { status: 204 });
  };
  const denied = await handleSiteRequest(operatorRequest(credentialPath, {
    method: "POST", headers: { Authorization: "Bearer disallowed-google-id-token" },
  }), operatorEnv, go);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { error: { code: "OPERATOR_NOT_ALLOWED" } });
  for (const revokePath of [currentCredentialPath, credentialPath]) {
    const credentialResponse = await handleSiteRequest(operatorRequest(credentialPath, {
      method: "POST", headers: { Authorization: "Bearer allowed-google-id-token" },
    }), operatorEnv, go);
    assert.equal(credentialResponse.status, 200);
    assertPrivateBridgeResponse(credentialResponse);
    const credential = await credentialResponse.json();
    assert.deepEqual(credential, { operatorToken: "opaque-operator-token", credentialId: "credential-1", expiresAt, role: "operator" });
    const proofRequest = operatorRequest("/arrival-token", {
      headers: { Authorization: `Bearer ${credential.operatorToken}`, "Sec-Fetch-Site": "same-origin" },
    });
    proofRequest.headers.delete("Origin");
    const proofResponse = await handleSiteRequest(proofRequest, operatorEnv, go);
    assert.equal(proofResponse.status, 200);
    assertPrivateBridgeResponse(proofResponse);
    assert.deepEqual(await proofResponse.json(), { checkpointToken: "signed-arrival-proof", expiresAt });
    const revoked = await handleSiteRequest(operatorRequest(revokePath, {
      method: "DELETE", headers: { Authorization: `Bearer ${credential.operatorToken}` },
    }), operatorEnv, go);
    assert.equal(revoked.status, 204);
    assert.equal(await revoked.text(), "");
    assertPrivateBridgeResponse(revoked);
    const afterRevoke = await handleSiteRequest(operatorRequest("/arrival-token", {
      headers: { Authorization: `Bearer ${credential.operatorToken}` },
    }), operatorEnv, go);
    assert.equal(afterRevoke.status, 401);
    assert.deepEqual(await afterRevoke.json(), { error: { code: "UNAUTHORIZED" } });
  }
  assert.equal(exchanges, 9);
});

test("hosted requests forward only server-held secret, validated auth/Origin and canonical edge IP", async () => {
  for (const [ip, expected] of [["203.0.113.42", "203.0.113.42"], ["2001:db8::42", "2001:db8::42"], ["010.0.0.1", null], ["203.0.113.42, 198.51.100.1", null], ["2001:DB8::42", null]]) {
    const response = await handleSiteRequest(operatorRequest("/arrival-token", {
      headers: {
        Cookie: "private-session=secret",
        "X-Trace-Edge-Secret": "browser-secret",
        "X-Trace-Client-IP": "198.51.100.1",
        "X-Forwarded-For": "198.51.100.2",
        "CF-Connecting-IP": ip,
        "Idempotency-Key": "discard",
        "Content-Type": "application/json",
        "X-Untrusted": "discard",
      },
    }), operatorEnv, async (upstream) => {
      assert.equal(upstream.url, "https://go.example.test/v1/operator/arrival-proofs");
      assert.equal(upstream.method, "POST");
      const expectedHeaders = {
        authorization: "Bearer operator-credential", origin: site, "x-trace-edge-secret": env.TRACE_EDGE_SHARED_SECRET,
      };
      if (expected) expectedHeaders["x-trace-client-ip"] = expected;
      assert.deepEqual(Object.fromEntries(upstream.headers), expectedHeaders);
      return Response.json({ checkpointToken: "proof", expiresAt: new Date(Date.now() + 60000).toISOString() }, {
        headers: { "Set-Cookie": "private=secret", "Access-Control-Allow-Origin": "*", "X-Trace-Edge-Secret": env.TRACE_EDGE_SHARED_SECRET, "X-Request-ID": "private-request" },
      });
    });
    assert.equal(response.status, 200);
    assertPrivateBridgeResponse(response);
    assert.equal((await response.text()).includes(env.TRACE_EDGE_SHARED_SECRET), false);
  }
});

test("hosted proof and credential outputs reject invalid status, shape, expiry and oversized bodies", async (t) => {
  const now = Date.parse("2030-01-01T00:00:00.000Z");
  t.mock.method(Date, "now", () => now);
  const proof = { checkpointToken: "proof", expiresAt: new Date(now + 60000).toISOString() };
  const credential = { operatorToken: "opaque", credentialId: "id", expiresAt: proof.expiresAt, role: "operator" };
  const invalid = [
    ["/arrival-token", "GET", 201, proof],
    ["/arrival-token", "GET", 200, { ...proof, checkpointToken: "" }],
    ["/arrival-token", "GET", 200, { ...proof, checkpointToken: 123 }],
    ["/arrival-token", "GET", 200, { ...proof, expiresAt: new Date(now + 4999).toISOString() }],
    ["/arrival-token", "GET", 200, { ...proof, expiresAt: new Date(now).toISOString() }],
    ["/arrival-token", "GET", 200, { ...proof, expiresAt: "invalid" }],
    ["/arrival-token", "GET", 200, { ...proof, expiresAt: now + 60000 }],
    ["/arrival-token", "GET", 200, null],
    ["/arrival-token", "GET", 200, { ...proof, extra: "x".repeat(16384) }],
    [credentialPath, "POST", 201, credential],
    [credentialPath, "POST", 200, { ...credential, expiresAt: new Date(now).toISOString() }],
    [credentialPath, "POST", 200, { ...credential, expiresAt: new Date(now - 1).toISOString() }],
    [credentialPath, "POST", 200, { ...credential, expiresAt: "invalid" }],
    [credentialPath, "POST", 200, { ...credential, expiresAt: now + 60000 }],
    [credentialPath, "POST", 200, { ...credential, operatorToken: "" }],
    [credentialPath, "POST", 200, { ...credential, credentialId: "" }],
    [credentialPath, "POST", 200, { ...credential, role: "admin" }],
    [currentCredentialPath, "DELETE", 200, {}],
    [credentialPath, "DELETE", 202, {}],
  ];
  for (const [path, method, status, body] of invalid) {
    const response = await handleSiteRequest(operatorRequest(path, { method }), operatorEnv, async () => Response.json(body, { status }));
    assert.equal(response.status, 502, `${method} ${path}: ${JSON.stringify(body).slice(0, 160)}`);
    assert.deepEqual(await response.json(), { error: { code: "BROKER_UPSTREAM_UNAVAILABLE" } });
    assertPrivateBridgeResponse(response);
  }
  for (const [path, method, body] of [
    ["/arrival-token", "GET", { ...proof, expiresAt: new Date(now + 5000).toISOString() }],
    [credentialPath, "POST", { ...credential, expiresAt: new Date(now + 1).toISOString() }],
  ]) {
    const response = await handleSiteRequest(operatorRequest(path, { method }), operatorEnv, async () => Response.json(body));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), body);
  }
  for (const status of [200, 204]) {
    const response = await handleSiteRequest(operatorRequest(), operatorEnv, async () => new Response(status === 204 ? null : "private malformed JSON", { status }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: { code: "BROKER_UPSTREAM_UNAVAILABLE" } });
  }
});

test("hosted upstream errors expose only a safe code, original error status and bounded numeric Retry-After", async () => {
  for (const [status, body, retry, expectedCode, expectedRetry] of [
    [401, { error: { code: "UNAUTHORIZED", token: "private-token" }, email: "private@example.test" }, "120", "UNAUTHORIZED", "120"],
    [403, { error: { code: "OPERATOR_NOT_ALLOWED" } }, "999999", "OPERATOR_NOT_ALLOWED", "999999"],
    [429, { error: { code: "RATE_LIMITED" } }, "1000000", "RATE_LIMITED", null],
    [500, { error: { code: "private-token" } }, "-1", "UPSTREAM_ERROR", null],
    [503, { error: { code: "A".repeat(81) } }, "Wed, 21 Oct 2030 07:28:00 GMT", "UPSTREAM_ERROR", null],
    [502, { error: { code: "BAD CODE" } }, "1, 2", "UPSTREAM_ERROR", null],
    [400, { error: { code: "" } }, "1.5", "UPSTREAM_ERROR", null],
    [401, { error: { code: "UNAUTHORIZED" }, private: "x".repeat(16384) }, "1", "UPSTREAM_ERROR", "1"],
  ]) {
    const response = await handleSiteRequest(operatorRequest(), operatorEnv, async () => Response.json(body, {
      status, headers: {
        "Retry-After": retry, "Set-Cookie": "private=secret", "Access-Control-Allow-Origin": "*",
        "X-Trace-Edge-Secret": env.TRACE_EDGE_SHARED_SECRET, "X-Request-ID": "private",
      },
    }));
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code: expectedCode } });
    assert.equal(response.headers.get("Retry-After"), expectedRetry);
    assertPrivateBridgeResponse(response);
  }
  const plain = await handleSiteRequest(operatorRequest(), operatorEnv, async () => new Response("private internal diagnostic", { status: 500 }));
  assert.equal(plain.status, 500);
  assert.deepEqual(await plain.json(), { error: { code: "UPSTREAM_ERROR" } });
});

test("hosted redirects and network failures never leak redirect locations or private diagnostics", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const response = await handleSiteRequest(operatorRequest(), operatorEnv, async () => new Response("private redirect diagnostic", {
      status, headers: { Location: "https://private.example.test/?token=secret", "Set-Cookie": "secret=1" },
    }));
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: { code: "BROKER_UPSTREAM_UNAVAILABLE" } });
    assertPrivateBridgeResponse(response);
  }
  const response = await handleSiteRequest(operatorRequest(), operatorEnv, async () => { throw new Error("private backend address and secret"); });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: { code: "BROKER_UPSTREAM_UNAVAILABLE" } });
  assertPrivateBridgeResponse(response);
});
