import assert from "node:assert/strict";
import { test } from "node:test";
import { OperatorSession } from "../../src/lib/display/operator-session.ts";

function setup() {
  let clock = Date.parse("2026-10-31T01:00:00Z");
  let issued = 0;
  let proofCount = 0;
  let denyIssue = false;
  let denyRevoke = false;
  const active = new Set();
  const statuses = [];
  const requests = [];
  const google = `header.${Buffer.from(JSON.stringify({ exp: clock / 1000 + 3600 })).toString("base64url")}.signature`;
  const transport = async (url, options) => {
    requests.push({ url, ...options });
    const auth = options.headers.Authorization;
    if (url.endsWith("/operator/credentials") && options.method === "POST") {
      if (denyIssue || auth !== `Bearer ${google}`) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
      const token = `opaque-${++issued}`;
      active.add(`Bearer ${token}`);
      return Response.json({ operatorToken: token, credentialId: `id-${issued}`, expiresAt: new Date(clock + 120000).toISOString(), role: "operator" });
    }
    if (!active.has(auth)) return Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
    if (options.method === "DELETE") {
      if (denyRevoke) return Response.json({ error: { code: "NOT_AVAILABLE" } }, { status: 503 });
      if (url.endsWith("/current")) active.delete(auth); else active.clear();
      return new Response(null, { status: 204 });
    }
    return Response.json({ checkpointToken: `proof-${++proofCount}.signature`, expiresAt: new Date(clock + 25000).toISOString() });
  };
  const session = new OperatorSession("http://127.0.0.1:8790", (state) => statuses.push(state), transport, () => clock);
  return { session, google, statuses, requests, active, advance: (ms) => { clock += ms; }, denyIssue: (value) => { denyIssue = value; }, denyRevoke: (value) => { denyRevoke = value; }, get issued() { return issued; } };
}

test("no QR before independent operator entitlement; denial remains visible without fabricated success", async () => {
  const env = setup();
  await assert.rejects(env.session.proof());
  assert.equal(env.requests.length, 0);
  env.denyIssue(true);
  await env.session.signIn(env.google);
  assert.equal(env.statuses.at(-1).state, "error");
  assert.match(env.statuses.at(-1).detail, /UNAUTHORIZED/);
  await assert.rejects(env.session.proof());
  assert.equal(env.requests.length, 1);
});

test("renews short-lived opaque authorization using Google identity, never renderer entitlement", async () => {
  const env = setup();
  await env.session.signIn(env.google);
  const first = await env.session.proof();
  env.advance(110000);
  const [second, third] = await Promise.all([env.session.proof(), env.session.proof()]);
  assert.equal(env.issued, 2); // concurrent refreshes share one issuance
  assert.notEqual(first.checkpointToken, second.checkpointToken);
  assert.notEqual(second.checkpointToken, third.checkpointToken);
  const mintRequests = env.requests.filter((r) => r.url.endsWith("/arrival-token"));
  assert.deepEqual(mintRequests.map((r) => r.headers.Authorization), ["Bearer opaque-1", "Bearer opaque-2", "Bearer opaque-2"]);
  for (const request of env.requests) {
    assert.equal(request.redirect, "error");
    assert.equal(request.credentials, "omit");
  }
});

test("current logout really revokes, clears authorization and cannot silently renew", async () => {
  const env = setup();
  await env.session.signIn(env.google);
  assert.equal(await env.session.logout(), true);
  assert.equal(env.active.size, 0);
  assert.equal(env.statuses.at(-1).state, "login");
  const requests = env.requests.length;
  await assert.rejects(env.session.proof());
  assert.equal(env.requests.length, requests);
});

test("failed revocation is a visible error and a later retry reaches the authority", async () => {
  const env = setup();
  await env.session.signIn(env.google);
  env.denyRevoke(true);
  assert.equal(await env.session.logout(true), false);
  assert.equal(env.statuses.at(-1).state, "error");
  assert.equal(env.active.size, 1);
  await assert.rejects(env.session.proof());
  env.denyRevoke(false);
  assert.equal(await env.session.logout(true), true);
  assert.equal(env.active.size, 0);
  assert.equal(env.requests.filter((r) => r.method === "DELETE").length, 2);
});

test("all-own logout without authority cannot claim another tab's credential was revoked", async () => {
  const env = setup();
  env.active.add("Bearer another-tab");
  assert.equal(await env.session.logout(true), false);
  assert.equal(env.statuses.at(-1).state, "error");
  assert.equal(env.active.has("Bearer another-tab"), true);
});

test("Google expiry requests new login; an expired identity cannot renew an operator token", async () => {
  const env = setup();
  await env.session.signIn(env.google);
  env.advance(3600000);
  await assert.rejects(env.session.proof(), /Google/);
  assert.equal(env.statuses.at(-1).state, "login");
  assert.equal(env.issued, 1);
});

test("revoked bearer cannot freeze a successful QR; explicit retry obtains a new credential", async () => {
  const env = setup();
  await env.session.signIn(env.google);
  await env.session.proof();
  env.active.clear();
  await assert.rejects(env.session.proof(), /UNAUTHORIZED/);
  assert.equal(env.statuses.at(-1).state, "error");
  await env.session.retry();
  assert.equal(env.issued, 2);
  assert.equal(env.statuses.at(-1).state, "ready");
  assert.equal(typeof (await env.session.proof()).checkpointToken, "string");
});
