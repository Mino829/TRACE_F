import { expect, test, type BrowserContext, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * /log after arriving at ShibaLab (#14): the keepsake drawn from the photos
 * kept on the phone, and each photo saved on its own. Like log-tabs.spec.ts,
 * the dev server runs with NEXT_PUBLIC_TRACE_API_URL=/api/backend and a
 * stand-in inside the test answers for TRACE_B. Chrome on a computer saves
 * by downloading, which is what is checked here; an iPhone's share sheet is not.
 */

const PHOTO = path.join(__dirname, "..", "models", "renders", "01_全体_南東の空から.jpg");
const HOUR = 60 * 60 * 1000;
const SHOTS = process.env.TRACE_TEST_SHOTS;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, geolocation: undefined, permissions: [], acceptDownloads: true });

/** Answers TRACE_B's participant routes; `replay` is where the arrival's replay stands, once there is one. */
async function standIn(context: BrowserContext): Promise<{ replay: "playing" | "completed" | null }> {
  const state: { replay: "playing" | "completed" | null } = { replay: null };
  const memorySession = { sessionId: "mem-1", expiresAt: new Date(Date.now() + 6 * HOUR).toISOString(), deleteAfter: new Date(Date.now() + 30 * HOUR).toISOString() };
  const displayAlias = { color: "cyan", symbol: "circle" };
  await context.route("**/api/backend/v1/**", async (route) => {
    const request = route.request();
    const where = `${request.method()} ${new URL(request.url()).pathname.replace("/api/backend", "")}`;
    if (where === "GET /v1/public/config") {
      return route.fulfill({ json: {
        registrationOpen: true, consent: { version: "consent-1", language: "ja", body: "" }, livePresenceConsentVersion: "live-1",
        photo: { enabled: true, maxCount: 12, maxUploadBytes: 3_000_000, maxLongEdgePixels: 1600, publicDisplay: false }, contact: "",
      } });
    }
    if (where === "POST /v1/experiences") {
      return route.fulfill({ status: 201, json: { experienceId: "exp-1", memorySession: { ...memorySession, participantToken: "token-1" }, displayAlias } });
    }
    if (where === "GET /v1/experiences/exp-1") {
      return route.fulfill({ json: {
        memorySession, displayAlias, photoSummary: { ready: 0, pending: 0, failed: 0, maxCount: 12 }, ...(state.replay ? { replayStatus: state.replay } : {}),
      } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", requestId: "req-1" } } });
  });
  await context.route("**/push-stub/**", (route) => route.fulfill({ json: { ok: true } }));
  return state;
}

/** The screen scrolls inside the phone, so it is taken a phone's height at a time: name-1.png, name-2.png… */
async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  const screen = page.locator(".screen").last();
  const { height, view } = await screen.evaluate((element) => ({ height: element.scrollHeight, view: element.clientHeight }));
  for (let part = 0; part * view < height; part += 1) {
    await screen.evaluate((element, top) => element.scrollTo(0, top), part * view);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${part + 1}.png`) });
  }
}

async function join(page: Page) {
  await page.goto("/log");
  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
}

async function savePhoto(page: Page, number: number) {
  await page.locator('input[type="file"][capture]').setInputFiles(PHOTO);
  await page.getByRole("button", { name: "場所を選ぶ" }).click();
  await page.getByRole("button", { name: "一覧で選ぶ" }).click();
  await page.getByRole("radio", { name: "本部棟", exact: true }).click();
  await page.getByRole("radio", { name: "5F", exact: true }).click();
  await page.getByRole("radio", { name: /本部棟5F/ }).click();
  await page.getByRole("button", { name: "ここで保存" }).click();
  await expect(page.getByText(`${number}枚目のメモリーを残しました`)).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "ホームへもどる" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
}

/** A downloaded JPEG: its name, its size in pixels, and whether it carries an EXIF block. */
async function jpeg(download: Download) {
  const bytes = await readFile(await download.path());
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  let width = 0;
  let height = 0;
  let exif = false;
  for (let at = 2; at + 9 < bytes.length && bytes[at] === 0xff; at += 2 + bytes.readUInt16BE(at + 2)) {
    const marker = bytes[at + 1];
    if (marker === 0xe1 && bytes.subarray(at + 4, at + 8).toString("latin1") === "Exif") exif = true;
    if (marker === 0xc0 || marker === 0xc2) {
      height = bytes.readUInt16BE(at + 5);
      width = bytes.readUInt16BE(at + 7);
      break;
    }
  }
  return { name: download.suggestedFilename(), width, height, exif };
}

test("after the replay, home leads to the keepsake, which saves as one picture without metadata; each photo saves too", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  await savePhoto(page, 2);

  // Before arriving, a photo saves from home's strip.
  const [single] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "2枚目の写真を保存" }).click()]);
  const photo = await jpeg(single);
  expect(photo.name).toMatch(/^TRACE_\d{4}-\d{2}-\d{2}_\d{4}\.jpg$/);
  expect(photo.exif).toBe(false);

  // TRACE_B has the arrival: home leads on to the replay, which leads to the keepsake once it is over.
  backend.replay = "playing";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "スクリーンを見てください" })).toBeVisible();
  backend.replay = "completed";
  await expect(page.getByRole("heading", { name: "作品を保存できます" })).toBeVisible({ timeout: 15000 });
  await shoot(page, "replay-done");
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "あなたの作品" })).toBeVisible();
  const art = page.getByRole("img", { name: /^作品。撮った2枚の写真/ });
  await expect(art).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/を過ぎると削除されます。/)).toBeVisible();
  await page.waitForTimeout(2000);
  await shoot(page, "keepsake");

  const [whole] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "作品を保存する" }).click()]);
  const keepsake = await jpeg(whole);
  expect(keepsake).toEqual({ name: expect.stringMatching(/^TRACE_\d{4}-\d{2}-\d{2}\.jpg$/), width: 1440, height: 2560, exif: false });

  // Each photo saves from the keepsake's own list too.
  const [again] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "1枚目の写真を保存" }).click()]);
  expect((await jpeg(again)).exif).toBe(false);
});

test("a browser without the photos says the keepsake cannot be made here", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "あなたの作品" })).toBeVisible();
  await expect(page.getByText(/この端末には写真が残っていないので/)).toBeVisible();
  await expect(page.getByRole("button", { name: "作品を保存する" })).toHaveCount(0);
  await shoot(page, "keepsake-empty");
});
