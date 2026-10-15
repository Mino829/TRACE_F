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

async function join(page: Page, live: boolean) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "体験をはじめる" })).toBeVisible();
  await expect(page.getByRole("button", { name: /同意して参加する/ })).toBeDisabled();
  await page.getByRole("checkbox", { name: /内容を確認し/ }).check();
  if (live) await page.getByRole("checkbox", { name: /位置情報を使った/ }).check();
  await page.getByRole("button", { name: /同意して参加する/ }).click();
  await expect(page.getByRole("heading", { name: "あなたの一歩を、展示へ。" })).toBeVisible();
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

test("arrival gate, stop and two-token deletion recover across partial and lost responses", async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await join(page, true);
  await expect(page.getByRole("button", { name: /位置送信を開始/ })).toBeVisible();
  await page.getByRole("button", { name: /位置送信を開始/ }).click();
  await expect(page.getByRole("status")).toHaveText("位置を送信しました。", { timeout: 15000 });
  await expect(page.getByText("約 8 m", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /位置送信を開始/ })).toBeVisible();
  await context.setGeolocation({ latitude: 36, longitude: 135, accuracy: 8 });
  await page.getByRole("button", { name: /位置送信を開始/ }).click();
  await expect(page.getByRole("status")).toContainText("対象エリア外", { timeout: 15000 });
  await page.getByRole("button", { name: /端末からの送信を一時停止/ }).click();
  await context.setGeolocation({ latitude: 35, longitude: 135, accuracy: 8 });
  await page.getByRole("button", { name: /位置送信を開始/ }).click();
  await expect(page.getByRole("status")).toHaveText("位置を送信しました。", { timeout: 15000 });

  // Merely walking/accepting a position cannot mark an arrival.
  await expect(page.getByRole("button", { name: /会場内の体験へ進む/ })).toHaveCount(0);
  await page.getByRole("button", { name: "この参加の位置送信を終了する" }).click();
  await expect(page.getByText("位置送信は終了しています", { exact: true })).toBeVisible();
  const current = await session(page);
  const state = await page.request.get(`/api/backend/v1/experiences/${current.experienceId}`, {
    headers: { Authorization: `Bearer ${current.memorySession.participantToken}` },
  });
  expect((await state.json()).livePresenceSession.presencePhase).toBe("ended");
  const stoppedPosition = await page.request.post(`/api/backend/v1/live-presence-sessions/${current.livePresenceSession!.sessionId}/position`, {
    headers: { Authorization: `Bearer ${current.livePresenceSession!.participantToken}` },
    data: { point: { latitude: 35, longitude: 135, accuracyM: 8, recordedAt: new Date().toISOString() } },
  });
  expect((await stoppedPosition.json()).error.code).toBe("TRACKING_STOPPED");

  // First the server reports only a partial result, then the complete reply is lost in transit.
  const keys: string[] = [];
  let attempts = 0;
  await page.route("**/api/backend/v1/experiences/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    attempts++;
    keys.push(route.request().headers()["idempotency-key"]);
    expect(route.request().headers()["authorization"]).toBe(`Bearer ${current.memorySession.participantToken}`);
    expect(route.request().headers()["x-trace-live-token"]).toBe(current.livePresenceSession!.participantToken);
    expect(route.request().postData()).toBeNull();
    if (attempts === 1) {
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ memory: "pending", live: "deleted", complete: false }) });
    } else if (attempts === 2) {
      await route.fetch();
      await route.abort();
    } else await route.continue();
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
  await expect(page.getByRole("heading", { name: "体験をはじめる" })).toBeVisible();
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem("trace.participant.v1"))).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("memory-only participation and individual deletion", async ({ page }) => {
  await join(page, false);
  expect((await session(page)).livePresenceSession).toBeUndefined();
  await expect(page.getByRole("button", { name: /位置送信を開始/ })).toHaveCount(0);
  await page.getByRole("button", { name: "メモリー参加情報を削除" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "体験をはじめる" })).toBeVisible();
});

test("deleting memory separately leaves a live credential for individual deletion", async ({ page }) => {
  await join(page, true);
  const original = await session(page);
  await page.getByRole("button", { name: "メモリー参加情報を削除" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  expect((await session(page)).livePresenceSession?.participantToken).toBe(original.livePresenceSession?.participantToken);
  await page.reload();
  let deletedPath = "";
  await page.route("**/api/backend/v1/**", async (route) => {
    if (route.request().method() === "DELETE") deletedPath = new URL(route.request().url()).pathname;
    await route.continue();
  });
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "体験をはじめる" })).toBeVisible();
  expect(deletedPath).toContain(`/v1/live-presence-sessions/${original.livePresenceSession!.sessionId}`);
});

test("one expired deletion window still allows deleting the other session", async ({ page }) => {
  await join(page, true);
  const original = await session(page);
  await page.addInitScript(() => {
    const key = "trace.participant.v1";
    const stored = JSON.parse(sessionStorage.getItem(key)!);
    stored.memorySession.deleteAfter = new Date(Date.now() - 1000).toISOString();
    sessionStorage.setItem(key, JSON.stringify(stored));
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "あなたの一歩を、展示へ。" })).toBeVisible();
  expect((await session(page)).memoryDeleted).toBe(true);
  expect((await session(page)).livePresenceSession?.participantToken).toBe(original.livePresenceSession?.participantToken);
  let deletedPath = "";
  await page.route("**/api/backend/v1/**", async (route) => {
    if (route.request().method() === "DELETE") deletedPath = new URL(route.request().url()).pathname;
    await route.continue();
  });
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "体験をはじめる" })).toBeVisible();
  expect(deletedPath).toContain(`/v1/live-presence-sessions/${original.livePresenceSession!.sessionId}`);
  const cleanup = await page.request.delete(`/api/backend/v1/memory-sessions/${original.memorySession.sessionId}`, {
    headers: { Authorization: `Bearer ${original.memorySession.participantToken}`, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(cleanup.status()).toBe(204);
});

test("server-side live deletion is reflected before deleting the remaining memory", async ({ page }) => {
  await join(page, true);
  const original = await session(page);
  const deleted = await page.request.delete(`/api/backend/v1/live-presence-sessions/${original.livePresenceSession!.sessionId}`, {
    headers: { Authorization: `Bearer ${original.livePresenceSession!.participantToken}`, "Idempotency-Key": crypto.randomUUID() },
  });
  expect(deleted.status()).toBe(204);
  await page.getByRole("button", { name: /参加状態を更新/ }).click();
  await expect(page.getByRole("button", { name: "位置参加情報を削除" })).toHaveCount(0);
  expect((await session(page)).livePresenceSession).toBeUndefined();
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "体験をはじめる" })).toBeVisible();
});

test("on-site consent appears only after the server reports arrived", async ({ page }) => {
  await join(page, true);
  await expect(page.getByRole("button", { name: /会場内の体験へ進む/ })).toHaveCount(0);
  await page.route("**/api/backend/v1/experiences/*", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const state = await response.json();
    await route.fulfill({ response, json: {
      ...state, livePresenceSession: { ...state.livePresenceSession, presencePhase: "arrived" },
    } });
  });
  await page.getByRole("button", { name: /参加状態を更新/ }).click();
  await expect(page.getByRole("button", { name: /会場内の体験へ進む/ })).toBeDisabled();
  await page.getByRole("checkbox", { name: "会場内の位置表現に同意する" }).check();
  await expect(page.getByRole("button", { name: /会場内の体験へ進む/ })).toBeEnabled();
});

test("mobile layout and permission refusal", async ({ page, context }) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 390, height: 844 });
  await join(page, true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /位置送信を開始/ }).click();
  await expect(page.getByRole("status")).toContainText("許可されていません", { timeout: 15000 });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
