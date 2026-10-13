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

test("consent, GPS, restoration, on-site, stop and partial-deletion recovery", async ({ page, context }) => {
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

  await page.getByRole("checkbox", { name: "会場内の位置表現に同意する" }).check();
  await page.getByRole("button", { name: /会場内の体験へ進む/ }).click();
  await expect(page.getByText("会場内の体験に参加中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "この参加の位置送信を終了する" }).click();
  await expect(page.getByText("位置送信は終了しています", { exact: true })).toBeVisible();
  const current = await session(page);
  const state = await page.request.get(`/api/backend/v1/experiences/${current.experienceId}`, {
    headers: { Authorization: `Bearer ${current.memorySession.participantToken}` },
  });
  expect((await state.json()).trackingStatus).toBe("stopped");
  const stoppedPosition = await page.request.post(`/api/backend/v1/live-presence-sessions/${current.livePresenceSession!.sessionId}/position`, {
    headers: { Authorization: `Bearer ${current.livePresenceSession!.participantToken}` },
    data: { point: { latitude: 35, longitude: 135, accuracyM: 8, recordedAt: new Date().toISOString() } },
  });
  expect((await stoppedPosition.json()).error.code).toBe("TRACKING_STOPPED");

  // Simulate a response lost after the server commits memory deletion.
  let interrupted = false;
  await page.route("**/api/backend/v1/memory-sessions/*", async (route) => {
    if (!interrupted && route.request().method() === "DELETE") {
      interrupted = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("region", { name: "参加状況" }).getByRole("alert")).toContainText("サーバーに接続できません");
  expect((await session(page)).livePresenceSession).toBeUndefined();
  await page.unroute("**/api/backend/v1/memory-sessions/*");
  await page.reload();
  await expect(page.getByRole("button", { name: "すべて削除して終了" })).toBeVisible();
  await page.getByRole("button", { name: "すべて削除して終了" }).click();
  await page.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(page.getByRole("heading", { name: "体験をはじめる" })).toBeVisible();
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

test("mobile layout and permission refusal", async ({ page, context }) => {
  await context.clearPermissions();
  await page.setViewportSize({ width: 390, height: 844 });
  await join(page, true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /位置送信を開始/ }).click();
  await expect(page.getByRole("status")).toContainText("許可されていません", { timeout: 15000 });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
