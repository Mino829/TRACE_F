import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  TRACE_API_URL,
  createExperience,
  deleteMemorySession,
  deletePhotoMoment,
  getExperience,
  listPhotoMoments,
  sendArrival,
  stopMemorySession,
} from "../../src/lib/trace-api/client.ts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const memory = {
  memorySessionId: "memory/owner",
  participantToken: "owner-token",
  expiresAt: "2026-10-31T18:00:00Z",
  deleteAfter: "2026-11-01T18:00:00Z",
};

const periods = { expiresAt: memory.expiresAt, deleteAfter: memory.deleteAfter };

const config = {
  registrationOpen: true,
  consent: { version: "consent-1", language: "ja", body: "" },
  livePresenceConsentVersion: "live-1",
};

test("memory-only enrollment requires no alias and starts in main", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${TRACE_API_URL}/v1/experiences`);
    assert.equal(JSON.parse(options.body).enableLivePresence, false);
    return Response.json({
      experienceId: "experience-1",
      memorySession: { sessionId: memory.memorySessionId, participantToken: memory.participantToken, status: "main", ...periods },
    }, { status: 201 });
  };
  assert.deepEqual(await createExperience(config), { experienceId: "experience-1", memory, status: "main" });
});
test("owner reads preserve main with a null replay and arrived after either final replay outcome", async () => {
  for (const [status, replayStatus] of [["main", null], ["arrived", "completed"], ["arrived", "skipped"], ["ended", "skipped"]]) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${TRACE_API_URL}/v1/experiences/experience%2Fowner`);
      assert.equal(options.headers.Authorization, "Bearer owner-token");
      return Response.json({ memorySession: { sessionId: memory.memorySessionId, status, ...periods }, replayStatus,
        photoSummary: { ready: 1, pending: 0, failed: 0, maxCount: 12 } });
    };
    const state = await getExperience("experience/owner", memory);
    assert.equal(state.memorySession.status, status);
    assert.equal(state.replayStatus, replayStatus);
  }
});

test("terminal stop sends an empty authenticated idempotent mutation and keeps the owner deletion credential", async () => {
  const stoppedAt = "2026-10-31T15:00:00Z";
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    assert.equal(url, `${TRACE_API_URL}/v1/memory-sessions/memory%2Fowner/stop`);
    assert.equal(options.method, "POST");
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, "Bearer owner-token");
    assert.equal(options.headers["Idempotency-Key"], "stop-key");
    return Response.json({ status: "ended", stoppedAt, ...periods });
  };
  const first = await stopMemorySession(memory, "stop-key");
  assert.deepEqual(await stopMemorySession(memory, "stop-key"), first);
  assert.deepEqual(first, { status: "ended", stoppedAt, ...periods });
  await deleteMemorySession(memory, "delete-key");
  assert.equal(requests[2].url, `${TRACE_API_URL}/v1/memory-sessions/memory%2Fowner`);
  assert.equal(requests[2].options.headers.Authorization, "Bearer owner-token");
  assert.equal(requests[2].options.headers["Idempotency-Key"], "delete-key");
});

test("arrival retry exposes the latest replay status for the same arrival", async () => {
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers["Idempotency-Key"], "arrival-key");
    calls += 1;
    return Response.json({ arrivalId: "arrival-1", status: calls === 1 ? "queued" : "completed" });
  };
  const attempt = { checkpointToken: "expired-on-retry", clientTime: "2026-10-31T15:00:00Z" };
  assert.deepEqual(await sendArrival(memory, attempt, "arrival-key"), { arrivalId: "arrival-1", status: "queued" });
  assert.deepEqual(await sendArrival(memory, attempt, "arrival-key"), { arrivalId: "arrival-1", status: "completed" });
});

test("retained owners read and delete photo metadata without recreating it after participation expires", async () => {
  const expired = { ...memory, expiresAt: "2026-10-01T18:00:00Z" };
  const photo = { photoMomentId: "photo/1", clientPhotoId: "local-1", checkpointId: "cp-a", capturedAt: "2026-10-01T15:00:00Z", sequenceNo: 1 };
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    assert.equal(options.headers.Authorization, "Bearer owner-token");
    assert.equal(options.body, undefined);
    if (options.method === "GET") {
      assert.equal(url, `${TRACE_API_URL}/v2/memory-sessions/memory%2Fowner/photos`);
      return Response.json({ photos: [photo] });
    }
    assert.equal(options.method, "DELETE");
    assert.equal(url, `${TRACE_API_URL}/v2/memory-sessions/memory%2Fowner/photos/photo%2F1`);
    assert.equal(options.headers["Idempotency-Key"], "delete-photo-key");
    return new Response(null, { status: 204 });
  };
  assert.deepEqual(await listPhotoMoments(expired), [photo]);
  await deletePhotoMoment(expired, photo.photoMomentId, "delete-photo-key");
  assert.deepEqual(requests.map(({ options }) => options.method), ["GET", "DELETE"]);
});
