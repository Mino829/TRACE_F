import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

/**
 * /log with the backend switched on: reloads, a second tab, and a
 * participation that cannot be continued. The dev server runs with
 * NEXT_PUBLIC_TRACE_API_URL=/api/backend and NEXT_PUBLIC_PUSH_API_URL=/push-stub
 * (in .env.local); a stand-in inside the test answers for TRACE_B and the
 * push worker, so neither has to run.
 */

const PHOTO = path.join(__dirname, "..", "models", "renders", "01_全体_南東の空から.jpg");
const HOUR = 60 * 60 * 1000;
const SHOTS = process.env.TRACE_TEST_SHOTS;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, geolocation: undefined, permissions: [] });

type StandIn = { deleted: boolean; experienceReads: number; uploads: string[]; uploading: Promise<void>; holdUploadsMs: number };

/** Answers TRACE_B's participant routes and the push worker's records for every tab of the context. */
async function standIn(context: BrowserContext): Promise<StandIn> {
  let uploadStarted!: () => void;
  const uploading = new Promise<void>((resolve) => {
    uploadStarted = () => resolve();
  });
  const state: StandIn = { deleted: false, experienceReads: 0, uploads: [], uploading, holdUploadsMs: 0 };
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
      state.deleted = false;
      return route.fulfill({ status: 201, json: { experienceId: "exp-1", memorySession: { ...memorySession, participantToken: "token-1" }, displayAlias } });
    }
    if (where === "GET /v1/experiences/exp-1") {
      state.experienceReads += 1;
      if (state.deleted) return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", requestId: "req-1" } } });
      return route.fulfill({ json: { memorySession, displayAlias, photoSummary: { ready: 0, pending: 0, failed: 0, maxCount: 12 } } });
    }
    if (where === "DELETE /v1/memory-sessions/mem-1") {
      state.deleted = true;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", requestId: "req-2" } } });
  });
  await context.route("**/push-stub/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith("/forget")) return route.fulfill({ json: { ok: true, deletedRecords: state.uploads.length } });
    if (!pathname.endsWith("/records")) return route.fulfill({ status: 404, json: {} });
    // The photo goes up as `<record id>.jpg`.
    const id = /filename="([^"]+)\.jpg"/.exec(route.request().postDataBuffer()?.toString("latin1") ?? "")?.[1] ?? "unknown";
    state.uploads.push(id);
    uploadStarted();
    await new Promise((resolve) => setTimeout(resolve, state.holdUploadsMs));
    return route.fulfill({ json: { ok: true } });
  });
  return state;
}

async function shoot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function join(page: Page) {
  await page.goto("/log");
  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
}

async function savePhoto(page: Page) {
  await page.locator('input[type="file"][capture]').setInputFiles(PHOTO);
  await page.getByRole("button", { name: "場所を選ぶ" }).click();
  await page.getByRole("button", { name: "一覧で選ぶ" }).click();
  await page.getByRole("radio", { name: "本部棟", exact: true }).click();
  await page.getByRole("radio", { name: "5F", exact: true }).click();
  await page.getByRole("radio", { name: /本部棟5F/ }).click();
  await page.getByRole("button", { name: "ここで保存" }).click();
}

const stored = (page: Page) =>
  page.evaluate(() => ({
    local: Object.keys(localStorage).filter((key) => key.startsWith("trace-memory") || key === "trace-experience").sort(),
    session: Object.keys(sessionStorage).filter((key) => key.startsWith("trace-memory") || key === "trace-experience"),
  }));

test("a reload and a second tab continue the same participation, and withdrawing in one tab ends it in the other", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  expect(await stored(page)).toEqual({ local: ["trace-experience", "trace-memory-credential"], session: [] });

  await page.reload();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /はじめる/ })).toHaveCount(0);

  const second = await context.newPage();
  await second.goto("/log");
  await expect(second.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
  expect(backend.experienceReads).toBeGreaterThan(0);

  await second.getByRole("button", { name: "メニュー" }).click();
  await second.getByRole("button", { name: "参加をやめる" }).click();
  await second.getByRole("button", { name: "やめて削除する" }).click();
  await expect(second.getByRole("button", { name: /はじめる/ })).toBeVisible();
  expect(backend.deleted).toBe(true);
  // The first tab hears it without a reload.
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  expect(await stored(page)).toEqual({ local: [], session: [] });
});

test("a photo saved while another tab opens is sent once, and both tabs show it", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  const second = await context.newPage();
  await second.goto("/log");
  await expect(second.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();

  // The first tab's upload is held, and the second tab reloads meanwhile and looks for unsent photos.
  backend.holdUploadsMs = 2500;
  await savePhoto(page);
  await backend.uploading;
  await second.reload();
  await expect(second.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
  await expect(page.getByText("1枚目のメモリーを残しました")).toBeVisible({ timeout: 15000 });
  await expect(second.getByText("1枚（12枚まで）")).toBeAttached();
  await second.waitForTimeout(3000);
  expect(backend.uploads).toHaveLength(1);
});

test("a participation the backend no longer knows is forgotten, with a note and the button to join again", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  backend.deleted = true;
  await page.reload();
  // The note keeps 「はじめる」 and から together with a word joiner, so only its first sentences are matched.
  await expect(page.getByRole("status").filter({ hasText: "参加の記録が見つかりませんでした。期限が切れたか、削除されています。" })).toBeVisible();
  await shoot(page, "tabs-not-found");
  expect(await stored(page)).toEqual({ local: [], session: [] });
  // The note is said once: the next visit starts as a new participation.
  await page.reload();
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /参加の記録|この画面には/ })).toHaveCount(0);

  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
});

test("past its deleteAfter the participation is forgotten without asking the backend", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await page.evaluate(() => {
    const credential = JSON.parse(localStorage.getItem("trace-memory-credential")!);
    localStorage.setItem("trace-memory-credential", JSON.stringify({ ...credential, deleteAfter: new Date(Date.now() - 1000).toISOString() }));
  });
  const reads = backend.experienceReads;
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "前の参加は、記録を残す期限が過ぎたので削除されました。" })).toBeVisible();
  await shoot(page, "tabs-lapsed");
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  expect(backend.experienceReads).toBe(reads);
  expect(await stored(page)).toEqual({ local: [], session: [] });
  await page.reload();
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /前の参加|この画面には/ })).toHaveCount(0);
});

test("an agreed browser without the participation says where it can be continued", async ({ context, page }) => {
  await standIn(context);
  await join(page);
  await page.evaluate(() => {
    localStorage.removeItem("trace-memory-credential");
    localStorage.removeItem("trace-experience");
  });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "この画面には、前の参加の記録がありません。参加を始めたブラウザか、ホーム画面のアプリで開いてください。" })).toBeVisible();
  await shoot(page, "tabs-no-record");
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
});
