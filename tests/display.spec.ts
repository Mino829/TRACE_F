import { test, expect, type Page } from "@playwright/test";

/**
 * The booth projector (/display, issue #24). No backend: the top screen's test
 * buttons stand in for an arriving visitor.
 */

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/display${query}`);
  // The campus (campus.glb) has loaded once the test buttons are live.
  await expect(page.getByRole("button", { name: /テスト再生/ })).toBeEnabled({ timeout: 60000 });
  return errors;
}

test("top screen shows the arrival QR in RAY", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  await expect(page.getByRole("heading", { name: "TRACE" })).toBeVisible();
  await expect(page.getByText("あなたの歩いた一日を、光でたどる。")).toBeVisible();
  const qr = page.getByLabel("到着の QR コード");
  await expect(qr).toBeVisible();
  // The code is drawn (not an empty canvas) and the countdown runs.
  expect(await qr.evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(100);
  await expect(page.getByText(/^NEXT \d{2}s$/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("a test walk plays on three views, keeps going after arriving, and ends on 終了する", async ({ page }) => {
  // Squeeze each walk into a few seconds so the test sees one end and the next start.
  const errors = await open(page, "?duration=4");
  await page.getByRole("button", { name: /テスト再生/ }).click();
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback");
  for (const name of ["光の先頭を追いかける視点", "一人称の視点", "キャンパス全体と軌跡"]) {
    await expect(page.getByLabel(name)).toBeVisible();
  }
  // The caption follows the walk: a named stop and where it is.
  await expect(page.locator(".dsp-play__stop")).not.toHaveText("…");
  await expect(page.locator(".dsp-label--here")).not.toBeEmpty();

  // Arrives at ShibaLab, then a test starts its next walk instead of going back to the top.
  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback", { timeout: 15000 });

  await page.getByRole("button", { name: /終了する/ }).click();
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  expect(errors).toEqual([]);
});

test("Space plays and Esc ends", async ({ page }) => {
  const errors = await open(page, "?duration=30");
  await page.keyboard.press("Space");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback");
  await page.keyboard.press("Escape");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  expect(errors).toEqual([]);
});

test("a random test walk ends at ShibaLab", async ({ page }) => {
  const errors = await open(page, "?duration=3");
  await page.getByRole("button", { name: /ランダムな道/ }).click();
  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".dsp-play__stop")).toHaveText("ShibaLab（教室棟3F 301）");
  expect(errors).toEqual([]);
});

// ?stops= walks through the given points (issue #76). The floors and the way between them are checked in tests/unit/test-routes.test.mjs.
for (const [name, stops, start] of [
  ["研究棟 11F → 6F の渡り廊下 → 教室棟のエスカレーター → ShibaLab", "research-11f-east,research-6f-east,classroom-research-6f-bridge,k6-019,shibalab", "研究棟 11F"],
  ["本部棟 11F → 4F の渡り廊下 → 交流棟 4F → 教室棟 4F → ShibaLab", "hq-11f,hq-4f-bridge,x4-025,x4-024,classroom-4f-lobby,classroom-3f-lobby,shibalab", "本部棟 11F"],
] as const) {
  test(`?stops: ${name}`, async ({ page }) => {
    test.setTimeout(120000);
    // Long enough that the first floor stays on the caption for a moment.
    const errors = await open(page, `?duration=30&stops=${stops}`);
    await page.getByRole("button", { name: /テスト再生/ }).click();
    await expect(page.locator(".dsp-play__place")).toHaveText(start);
    await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 45000 });
    await expect(page.locator(".dsp-play__stop")).toHaveText("ShibaLab（教室棟3F 301）");
    expect(errors).toEqual([]);
  });
}

test("?stops: a point not on the network says which one", async ({ page }) => {
  await page.goto("/display?stops=hq-11f,no-such-point,shibalab");
  await expect(page.locator(".dsp-error")).toContainText("no-such-point", { timeout: 60000 });
});

test("sound: placeholders stand in for missing files, and 音を出す goes once sound is on", async ({ page }) => {
  const errors = await open(page, "?sound=1&duration=4");
  // All four cues are ready; with no files in public/display/sound/ they are the placeholders.
  const sources = page.locator(".dsp-sound-sources");
  await expect(sources).toContainText(/wait:\S+ \/ scan:\S+ \/ play:\S+ \/ arrive:\S+/);
  await expect(sources).not.toContainText("…");
  // Headless Chromium may allow sound without a click; when it doesn't, the button unlocks it.
  const button = page.getByRole("button", { name: "♪ 音を出す" });
  if (await button.isVisible()) await button.click();
  await expect(button).toBeHidden();
  // A walk with sound plays through to the arrival, and on to the next.
  await page.getByRole("button", { name: /テスト再生/ }).click();
  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback", { timeout: 15000 });
  await page.getByRole("button", { name: /終了する/ }).click();
  expect(errors).toEqual([]);
});

test("sound: ?mute=1 never asks for sound", async ({ page }) => {
  const errors = await open(page, "?mute=1");
  await expect(page.getByRole("button", { name: "♪ 音を出す" })).toHaveCount(0);
  expect(errors).toEqual([]);
});
