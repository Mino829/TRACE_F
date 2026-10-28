import assert from "node:assert/strict";
import { test } from "node:test";

import { LockTimeout, withLock } from "../../src/lib/ping-log/tabs.ts";

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Records how many tasks run at once. */
function counter() {
  let running = 0;
  const state = { most: 0, order: [] };
  state.task = (label, ms = 20) => async () => {
    running += 1;
    state.most = Math.max(state.most, running);
    await wait(ms);
    state.order.push(label);
    running -= 1;
    return label;
  };
  return state;
}

/** Enough of the Web Locks API for withLock: exclusive locks in request order, given up when the signal aborts first. */
function fakeLocks() {
  const queues = new Map();
  return {
    request(name, options, callback) {
      const before = queues.get(name) ?? Promise.resolve();
      const granted = new Promise((resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(options.signal.reason), { once: true });
        void before.then(resolve);
      });
      const result = granted.then(() => callback({ name, mode: "exclusive" }));
      queues.set(name, Promise.allSettled([before, result]));
      return result;
    },
  };
}

for (const [label, locks] of [["without Web Locks", null], ["with Web Locks", fakeLocks()]]) {
  test(`${label}, callers of one lock run one at a time, in the order they asked`, async () => {
    const state = counter();
    const results = await Promise.all(["a", "b", "c"].map((name) => withLock("send", state.task(name), { locks })));
    assert.deepEqual(results, ["a", "b", "c"]);
    assert.deepEqual(state.order, ["a", "b", "c"]);
    assert.equal(state.most, 1);
  });

  test(`${label}, a caller that waits too long gives up before its task runs, and the next one still gets its turn`, async () => {
    const state = counter();
    const first = withLock("send", state.task("first", 80), { locks });
    const impatient = withLock("send", state.task("impatient"), { locks, waitMs: 20 });
    const patient = withLock("send", state.task("patient"), { locks });
    await assert.rejects(impatient, LockTimeout);
    assert.equal(await first, "first");
    assert.equal(await patient, "patient");
    assert.deepEqual(state.order, ["first", "patient"]);
    assert.equal(state.most, 1);
  });

  test(`${label}, a task's own failure reaches its caller and frees the lock`, async () => {
    const failing = withLock("send", async () => {
      await wait(40);
      throw new Error("upload failed");
    }, { locks, waitMs: 10 });
    await assert.rejects(failing, /upload failed/);
    assert.equal(await withLock("send", async () => "next", { locks }), "next");
  });

  test(`${label}, different locks do not wait for each other`, async () => {
    const state = counter();
    await Promise.all([withLock("send", state.task("send", 40), { locks }), withLock("trace-once:arrival", state.task("arrival", 40), { locks })]);
    assert.equal(state.most, 2);
  });
}
