import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

/** A browser's localStorage, shared by every "tab" of the test. */
class MemoryStorage {
  #items = new Map();
  get length() {
    return this.#items.size;
  }
  getItem(key) {
    return this.#items.has(key) ? this.#items.get(key) : null;
  }
  setItem(key, value) {
    this.#items.set(key, String(value));
  }
  removeItem(key) {
    this.#items.delete(key);
  }
  keys() {
    return [...this.#items.keys()].sort();
  }
}

globalThis.window = { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() };

const {
  actionKey,
  clearTabExperience,
  experienceLapsed,
  forgetLapsedExperience,
  loadTabExperience,
  memoryDeleteKey,
  saveTabExperience,
  sendOnce,
  updateTabExperience,
} = await import("../../src/lib/trace-api/session.ts");

const HOUR = 60 * 60 * 1000;
const now = Date.parse("2026-10-31T12:00:00+09:00");

function experience(memorySessionId = "mem-1") {
  return {
    experienceId: "exp-1",
    displayAlias: { color: "cyan", symbol: "circle" },
    consentVersion: "v1",
    createdAt: new Date(now - HOUR).toISOString(),
    memory: {
      memorySessionId,
      participantToken: "token-1",
      expiresAt: new Date(now + 6 * HOUR).toISOString(),
      deleteAfter: new Date(now + 30 * HOUR).toISOString(),
    },
  };
}

beforeEach(() => {
  window.localStorage = new MemoryStorage();
  window.sessionStorage = new MemoryStorage();
});

test("a joined experience is kept in localStorage, so a reload or another tab continues it", () => {
  saveTabExperience(experience());
  assert.deepEqual(loadTabExperience(now), experience());
  assert.deepEqual(window.localStorage.keys(), ["trace-experience", "trace-memory-credential"]);
  assert.equal(window.sessionStorage.length, 0);
});

test("after expiresAt the experience is still there until deleteAfter, so the participant can still delete it", () => {
  saveTabExperience(experience());
  assert.notEqual(loadTabExperience(now + 7 * HOUR), null);
  assert.equal(experienceLapsed(now + 7 * HOUR), false);
  assert.equal(forgetLapsedExperience(now + 7 * HOUR), false);
});

test("past deleteAfter nothing is continued, and the credential is forgotten once", () => {
  saveTabExperience(experience());
  memoryDeleteKey("mem-1");
  const later = now + 31 * HOUR;
  assert.equal(loadTabExperience(later), null);
  assert.equal(experienceLapsed(later), true);
  assert.equal(forgetLapsedExperience(later), true);
  assert.deepEqual(window.localStorage.keys(), []);
  assert.equal(experienceLapsed(later), false);
  assert.equal(forgetLapsedExperience(later), false);
});

test("a credential without its token, session or periods is not continued", () => {
  for (const broken of [{ participantToken: "" }, { memorySessionId: "" }, { expiresAt: undefined }, { deleteAfter: undefined }]) {
    const value = experience();
    saveTabExperience({ ...value, memory: { ...value.memory, ...broken } });
    assert.equal(loadTabExperience(now), null);
  }
});

test("withdrawing clears the credential, the experience and the action keys", () => {
  saveTabExperience(experience());
  memoryDeleteKey("mem-1");
  clearTabExperience();
  assert.equal(loadTabExperience(now), null);
  assert.deepEqual(window.localStorage.keys(), []);
});

test("the backend's newer periods replace the stored ones; another memory session's answer is refused", () => {
  saveTabExperience(experience());
  const deleteAfter = new Date(now + 40 * HOUR).toISOString();
  const update = { memorySession: { sessionId: "mem-1", expiresAt: new Date(now + 2 * HOUR).toISOString(), deleteAfter },
    displayAlias: { color: "lime", symbol: "star" }, photoSummary: { ready: 0, pending: 0, failed: 0, maxCount: 12 } };
  updateTabExperience(experience(), update);
  assert.equal(loadTabExperience(now).memory.deleteAfter, deleteAfter);
  assert.equal(loadTabExperience(now).displayAlias.color, "lime");
  assert.throws(() => updateTabExperience(experience(), { ...update, memorySession: { ...update.memorySession, sessionId: "mem-2" } }));
});

test("the delete key is the same on every retry, from any tab, and new for another memory session", () => {
  const key = memoryDeleteKey("mem-1");
  assert.equal(memoryDeleteKey("mem-1"), key);
  assert.notEqual(memoryDeleteKey("mem-2"), key);
});

test("an action's key is reused for the same request and replaced for a request with other content", () => {
  const first = actionKey("mem-1", "arrival", { checkpointToken: "qr-1" });
  assert.equal(actionKey("mem-1", "arrival", { checkpointToken: "qr-1" }), first);
  const second = actionKey("mem-1", "arrival", { checkpointToken: "qr-2" });
  assert.notEqual(second, first);
  assert.notEqual(actionKey("mem-1", "delete"), second);
});

test("two calls sending the arrival at once send it once, and both get the first answer", async () => {
  const sent = [];
  const send = async (key) => {
    sent.push(key);
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { arrivalId: "arrival-1" };
  };
  const answers = await Promise.all([
    sendOnce("mem-1", "arrival", { checkpointToken: "qr-1" }, send),
    sendOnce("mem-1", "arrival", { checkpointToken: "qr-1" }, send),
  ]);
  assert.equal(sent.length, 1);
  assert.deepEqual(answers, [{ arrivalId: "arrival-1" }, { arrivalId: "arrival-1" }]);
});

test("after the arrival was answered, a reload or a fresh QR code gets the first answer without sending", async () => {
  await sendOnce("mem-1", "arrival", { checkpointToken: "qr-1" }, async () => ({ arrivalId: "arrival-1" }));
  const answer = await sendOnce("mem-1", "arrival", { checkpointToken: "qr-2" }, async () => assert.fail("sent twice"));
  assert.deepEqual(answer, { arrivalId: "arrival-1" });
});

test("an arrival whose answer was lost is sent again with the same key", async () => {
  const keys = [];
  await assert.rejects(sendOnce("mem-1", "arrival", { checkpointToken: "qr-1" }, async (key) => {
    keys.push(key);
    throw new Error("network");
  }));
  await sendOnce("mem-1", "arrival", { checkpointToken: "qr-1" }, async (key) => {
    keys.push(key);
    return { arrivalId: "arrival-1" };
  });
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
});

test("a new participation sends its own arrival", async () => {
  await sendOnce("mem-1", "arrival", null, async () => "first");
  assert.equal(await sendOnce("mem-2", "arrival", null, async () => "second"), "second");
});
