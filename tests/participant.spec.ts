import { test, expect, type Page } from "@playwright/test";

type Session = {
  experienceId: string;
  memoryDeleted?: boolean;
  memorySession: { sessionId: string; participantToken: string };
  livePresenceSession?: { sessionId: string; participantToken: string };
};

async function session(page: Page): Promise<Session> {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem("trace.participant.v1")!));
}

/** New joins are memory-only. Legacy Live owner credentials are supplied by a stateful fixture, never minted by enrollment. */
async function storedSession(page: Page, live: boolean) {
  // Without one, the root sends the tab on to /log; the credential is stored there and the root opened again.
  await page.goto("/");
  await page.waitForURL("**/log");
  const config = await (await page.request.get("/api/backend/v1/public/config")).json();
  const response = await page.request.post("/api/backend/v1/experiences", { data: {
    memoryConsentVersion: config.consent.version,
    livePresenceConsentVersion: config.livePresenceConsentVersion,
    enableLivePresence: false,
    consentLanguage: config.consent.language,
    clientTime: new Date().toISOString(),
  } });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  if (live) {
    const credential = {
      sessionId: `legacy-live-${crypto.randomUUID()}`, participantToken: "synthetic-legacy-owner",
      expiresAt: created.memorySession.expiresAt, deleteAfter: created.memorySession.deleteAfter,
      trackingStatus: "tracking",
    };
    let deleted = false;
    await page.route("**/api/backend/v1/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname.replace("/api/backend", "");
      if (pathname === `/v1/live-presence-sessions/${credential.sessionId}` || pathname === `/v1/live-presence-sessions/${credential.sessionId}/stop`) {
        expect(request.headers().authorization).toBe(`Bearer ${credential.participantToken}`);
        if (request.method() === "DELETE") {
          deleted = true;
          return route.fulfill({ status: 204 });
        }
        if (deleted) return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } });
        if (request.method() === "POST") credential.trackingStatus = "stopped";
        return route.fulfill({ json: { sessionId: credential.sessionId, trackingStatus: credential.trackingStatus, expiresAt: credential.expiresAt, deleteAfter: credential.deleteAfter } });
      }
      if (pathname === `/v1/experiences/${created.experienceId}` && request.method() === "DELETE") {
        expect(request.headers()["x-trace-live-token"]).toBe(credential.participantToken);
        const response = await page.request.delete(`/api/backend/v1/memory-sessions/${created.memorySession.sessionId}`, {
          headers: { Authorization: `Bearer ${created.memorySession.participantToken}`, "Idempotency-Key": request.headers()["idempotency-key"] },
        });
        expect(response.status()).toBe(204);
        deleted = true;
        return route.fulfill({ json: { memory: "deleted", live: "deleted", complete: true } });
      }
      return route.fallback();
    });
    created.livePresenceSession = credential;
  }
  await page.evaluate((value) => sessionStorage.setItem("trace.participant.v1", JSON.stringify({ ...value, operationKeys: {} })), created);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "参加状況" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
}

async function legacySession(page: Page) {
  await storedSession(page, true);
}

test.afterEach(async ({ page }) => {
  // Only remove credentials created by this test browser context.
  const value = await page.evaluate(() => sessionStorage.getItem("trace.participant.v1")).catch(() => null);
  if (!value) return;
  const current = JSON.parse(value) as Session;
  for (const [kind, credential] of [["live-presence", current.livePresenceSession], ["memory", current.memoryDeleted ? undefined : current.memorySession]] as const) {
    if (!credential) continue;
    await page.request.delete(`/api/backend/v1/${kind}-sessions/${credential.sessionId}`, {
      headers: { Authorization: `Bearer ${credential.participantToken}`, "Idempotency-Key": crypto.randomUUID() },
    });
  }
});

test("legacy live sessions can stop and two-token deletion recovers across partial and lost responses", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await legacySession(page);
  await expect(page.getByRole("button", { name: /位置送信を開始/ })).toHaveCount(0);
  await page.getByRole("button", { name: "この参加の位置送信を終了する" }).click();
  await expect(page.getByText("位置送信は終了しています", { exact: true })).toBeVisible();
  const current = await session(page);
  expect((await page.evaluate(async (credential) => {
    const response = await fetch(`/api/backend/v1/live-presence-sessions/${credential.sessionId}`, {
      headers: { Authorization: `Bearer ${credential.participantToken}` },
    });
    return response.json();
  }, current.livePresenceSession!)).trackingStatus).toBe("stopped");

  // First the server reports only a partial result, then the complete reply is lost in transit.
  const keys: string[] = [];
  let attempts = 0;
  await page.route("**/api/backend/v1/experiences/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    attempts++;
    keys.push(route.request().headers()["idempotency-key"]);
    expect(route.request().headers()["authorization"]).toBe(`Bearer ${current.memorySession.participantToken}`);
    expect(route.request().headers()["x-trace-live-token"]).toBe(current.livePresenceSession!.participantToken);
    expect(route.request().postData()).toBeNull();
    if (attempts === 1) {
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ memory: "pending", live: "deleted", complete: false }) });
    } else if (attempts === 2) {
      const response = await page.request.delete(`/api/backend/v1/memory-sessions/${current.memorySession.sessionId}`, {
        headers: { Authorization: `Bearer ${current.memorySession.participantToken}`, "Idempotency-Key": keys[0] },
      });
      expect(response.status()).toBe(204);
      await route.abort();
    } else await route.fallback();
  });
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByText(/削除は保留中です/)).toBeVisible();
  expect((await session(page)).livePresenceSession?.participantToken).toBe(current.livePresenceSession!.participantToken);
  expect((await session(page)).memorySession.participantToken).toBe(current.memorySession.participantToken);
  await page.reload();
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("region", { name: "参加状況" }).getByRole("alert")).toContainText("サーバーに接続できません");
  expect((await session(page)).livePresenceSession?.participantToken).toBe(current.livePresenceSession!.participantToken);
  await page.reload();
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新しい参加の準備中です" })).toBeVisible();
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem("trace.participant.v1"))).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("a previous memory-only participant can still delete their data", async ({ page }) => {
  await storedSession(page, false);
  expect((await session(page)).livePresenceSession).toBeUndefined();
  await expect(page.getByRole("button", { name: /位置送信を開始/ })).toHaveCount(0);
  await page.getByRole("button", { name: "メモリー参加情報を削除" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新しい参加の準備中です" })).toBeVisible();
});

test("memory stop is terminal, survives a lost reply, and retains owner read/delete rights", async ({ page }) => {
  await storedSession(page, false);
  const original = await session(page);
  const keys: string[] = [];
  let attempts = 0;
  await page.route(`**/v1/memory-sessions/${original.memorySession.sessionId}/stop`, async (route) => {
    expect(route.request().postData()).toBeNull();
    keys.push(route.request().headers()["idempotency-key"]);
    attempts += 1;
    if (attempts === 1) {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "メモリー参加を終了する", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("サーバーに接続できません");
  // The first request committed, so a state read also recovers the terminal outcome.
  await page.getByRole("button", { name: /参加状態を更新/ }).click();
  await expect(page.getByRole("heading", { name: "メモリー参加は終了しました" })).toBeVisible();
  await expect(page.getByRole("button", { name: "メモリー参加を終了する", exact: true })).toHaveCount(0);
  expect((await session(page)).memorySession.participantToken).toBe(original.memorySession.participantToken);
  const stopped = await page.request.get(`/api/backend/v1/experiences/${original.experienceId}`, {
    headers: { Authorization: `Bearer ${original.memorySession.participantToken}` },
  });
  expect(stopped.status()).toBe(200);
  const state = await stopped.json();
  expect(state.memorySession.status).toBe("ended");
  expect(state.replayStatus).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { name: "メモリー参加は終了しました" })).toBeVisible();
  await page.getByRole("button", { name: "メモリー参加情報を削除" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新しい参加の準備中です" })).toBeVisible();
  expect(keys).toHaveLength(1);
});


test("after memory deletion a legacy owner can independently read, stop and delete Live", async ({ page }) => {
  await legacySession(page);
  const original = await session(page);
  await page.getByRole("button", { name: "メモリー参加情報を削除" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  expect((await session(page)).livePresenceSession?.participantToken).toBe(original.livePresenceSession?.participantToken);
  const [liveRead] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "GET" && response.url().endsWith(`/v1/live-presence-sessions/${original.livePresenceSession!.sessionId}`)),
    page.reload(),
  ]);
  expect((await liveRead.json()).trackingStatus).toBe("tracking");
  await expect(page.getByRole("button", { name: "メモリー参加情報を削除" })).toHaveCount(0);
  await page.getByRole("button", { name: "この参加の位置送信を終了する" }).click();
  await expect(page.getByText("位置送信は終了しています", { exact: true })).toBeVisible();
  let deletedPath = "";
  await page.route("**/api/backend/v1/**", async (route) => {
    if (route.request().method() === "DELETE") deletedPath = new URL(route.request().url()).pathname;
    await route.fallback();
  });
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新しい参加の準備中です" })).toBeVisible();
  expect(deletedPath).toContain(`/v1/live-presence-sessions/${original.livePresenceSession!.sessionId}`);
});

test("one expired deletion window still allows deleting the other session", async ({ page }) => {
  await legacySession(page);
  const original = await session(page);
  await page.addInitScript(() => {
    const key = "trace.participant.v1";
    const stored = JSON.parse(sessionStorage.getItem(key)!);
    stored.memorySession.deleteAfter = new Date(Date.now() - 1000).toISOString();
    sessionStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  await expect(page.getByRole("region", { name: "参加状況" })).toBeVisible();
  expect((await session(page)).memoryDeleted).toBe(true);
  expect((await session(page)).livePresenceSession?.participantToken).toBe(original.livePresenceSession?.participantToken);
  let deletedPath = "";
  await page.route("**/api/backend/v1/**", async (route) => {
    if (route.request().method() === "DELETE") deletedPath = new URL(route.request().url()).pathname;
    await route.fallback();
  });
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新しい参加の準備中です" })).toBeVisible();
  expect(deletedPath).toContain(`/v1/live-presence-sessions/${original.livePresenceSession!.sessionId}`);
  const cleanup = await page.request.delete(`/api/backend/v1/memory-sessions/${original.memorySession.sessionId}`, {
    headers: { Authorization: `Bearer ${original.memorySession.participantToken}`, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(cleanup.status()).toBe(204);
});

test("server-side legacy live deletion is reflected before deleting the remaining memory", async ({ page }) => {
  await legacySession(page);
  const original = await session(page);
  const deletedStatus = await page.evaluate(async (credential) => {
    const response = await fetch(`/api/backend/v1/live-presence-sessions/${credential.sessionId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${credential.participantToken}`, "Idempotency-Key": crypto.randomUUID() },
    });
    return response.status;
  }, original.livePresenceSession!);
  expect(deletedStatus).toBe(204);
  await page.getByRole("button", { name: /参加状態を更新/ }).click();
  await expect(page.getByRole("button", { name: "位置参加情報を削除" })).toHaveCount(0);
  expect((await session(page)).livePresenceSession).toBeUndefined();
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新しい参加の準備中です" })).toBeVisible();
});

test("the root entry sends a tab with no earlier participation on to /log, never touching location", async ({ page, context }) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.defineProperty(window, "__geoCalls", { value: calls, configurable: true });
    const location = navigator.geolocation;
    if (location) {
      location.getCurrentPosition = () => { calls.push("getCurrentPosition"); throw new Error("location disabled"); };
      location.watchPosition = () => { calls.push("watchPosition"); throw new Error("location disabled"); };
    }
    if (navigator.permissions) {
      const original = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (descriptor) => {
        if (descriptor.name === "geolocation") calls.push("permission query");
        return original(descriptor);
      };
    }
  });
  await page.goto("/?ref=qr#top");
  await page.waitForURL(/\/log\?ref=qr#top$/);
  await expect(page.getByRole("heading", { name: "新しい参加の準備中です" })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "__geoCalls"))).toEqual([]);
});
