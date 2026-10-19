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
