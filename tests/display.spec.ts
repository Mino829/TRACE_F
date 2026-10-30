import { test, expect, type Page } from "@playwright/test";
import { RELAY_LANDS_MS } from "../src/lib/display/relay";
import { TEST_ROUTES } from "./test-routes";

/**
 * The booth projector (/display, issue #24). No backend: the top screen's test
 * buttons stand in for an arriving visitor. Each walk starts after the light
 * from the visitor's phone has come in (data-screen "intro", RELAY_LANDS_MS).
 */

/** The light comes in for RELAY_LANDS_MS before a walk plays. */
const WALK_STARTS = { timeout: RELAY_LANDS_MS + 6000 };

async function open(page: Page, query = "") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  // ?dev: the test buttons stand in for a visitor.
  await page.goto(`/display${query ? `${query}&dev` : "?dev"}`);
  // The campus (campus.glb) has loaded once the test buttons are live.
  await expect(page.getByRole("button", { name: /テスト再生/ })).toBeEnabled({ timeout: 60000 });
  return errors;
}

test("top screen leaves the arrival QR blank before operator sign-in", async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  const qr = page.getByLabel("到着の QR コード");
  await expect(qr).toBeVisible();
  // A canvas exists even without credentials; its default width does not prove a QR was drawn.
  expect(await qr.evaluate((c: HTMLCanvasElement) => {
    const context = c.getContext("2d");
    return context !== null && context.getImageData(0, 0, c.width, c.height).data.every((channel) => channel === 0);
  })).toBe(true);
  expect(errors).toEqual([]);
});

test("without ?dev the projector shows visitors no team controls", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/display");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top", { timeout: 60000 });
  await expect(page.getByRole("button", { name: /テスト再生|ランダムな道|終了する/ })).toHaveCount(0);
  await expect(page.getByText(/^TEST$|LINK ·|運営 ·|運営認証待ち|未設定/)).toHaveCount(0);
  await expect(page.getByText("ARRIVAL QR · 準備中")).toBeVisible();
  // Space plays nothing for a visitor.
  await page.keyboard.press("Space");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  expect(errors).toEqual([]);
});

test("a test walk plays on three views, keeps going after arriving, and ends on 終了する", async ({ page }) => {
  // Squeeze each walk into a few seconds so the test sees one end and the next start.
  const errors = await open(page, "?duration=4");
  await page.getByRole("button", { name: /テスト再生/ }).click();
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "intro");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback", WALK_STARTS);
  for (const name of ["光の先頭を追いかける視点", "一人称の視点", "キャンパス全体と軌跡"]) {
    await expect(page.getByLabel(name)).toBeVisible();
  }

  // Arrives at ShibaLab, then a test starts its next walk instead of going back to the top.
  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback", { timeout: 15000 });

  await page.getByRole("button", { name: /終了する/ }).click();
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  expect(errors).toEqual([]);
});

test("Space plays and Esc ends, also while the light is coming in", async ({ page }) => {
  const errors = await open(page, "?duration=30");
  await page.keyboard.press("Space");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "intro");
  await page.keyboard.press("Escape");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  // The light that was coming in does not start the walk after all.
  await page.waitForTimeout(RELAY_LANDS_MS + 1000);
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");

  await page.keyboard.press("Space");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback", WALK_STARTS);
  await page.keyboard.press("Escape");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  expect(errors).toEqual([]);
});

test("a random test walk ends at ShibaLab", async ({ page }) => {
  const errors = await open(page, "?duration=3");
  await page.getByRole("button", { name: /ランダムな道/ }).click();
  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

// ?stops= walks through the given points (issue #76): every test walk (tests/test-routes.ts) plays through to ShibaLab.
//   The floors and the way between them are checked in tests/unit/test-routes.test.mjs.
for (const route of TEST_ROUTES) {
  test(`?stops ${route.id}: ${route.name}`, async ({ page }) => {
    const errors = await open(page, `?duration=8&stops=${route.stops.join(",")}`);
    await page.getByRole("button", { name: /テスト再生/ }).click();
    await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback", WALK_STARTS);
    await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 20000 });
    expect(errors).toEqual([]);
  });
}

test("?stops: a point not on the network says which one", async ({ page }) => {
  await page.goto("/display?stops=hq-11f,no-such-point,shibalab");
  await expect(page.locator(".dsp-error")).toContainText("no-such-point", { timeout: 60000 });
});

test("sound: 音を出す goes once sound is on and playback continues", async ({ page }) => {
  const errors = await open(page, "?duration=4");
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
