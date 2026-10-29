import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

/**
 * /log's standard same-origin backend connection: reloads, a second tab,
 * and a participation that cannot be continued. A stand-in answers the
 * backend and the optional legacy push worker, so neither has to run.
 */

const PHOTO = path.join(__dirname, "..", "models", "renders", "01_全体_南東の空から.jpg");
const HOUR = 60 * 60 * 1000;
const SHOTS = process.env.TRACE_TEST_SHOTS;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, geolocation: undefined, permissions: [] });

type StandIn = { deleted: boolean; ended: boolean; experienceReads: number; uploads: string[]; stopKeys: string[] };

const PUBLIC_CONFIG = {
  registrationOpen: true,
  consent: { version: "consent-1", language: "ja", body: "写真は端末に保存し、選択した場所と撮影時刻のみをサーバーに記録します。テスト用の参加説明です。" },
  livePresenceConsentVersion: "live-1",
  photo: { enabled: true, maxCount: 12, maxUploadBytes: 3_000_000, maxLongEdgePixels: 1600, publicDisplay: false },
  contact: "",
};

/** Answers TRACE_B's participant routes and the push worker's records for every tab of the context. */
async function standIn(context: BrowserContext): Promise<StandIn> {
  const state: StandIn = { deleted: false, ended: false, experienceReads: 0, uploads: [], stopKeys: [] };
  const memorySession = { sessionId: "mem-1", status: "main", expiresAt: new Date(Date.now() + 6 * HOUR).toISOString(), deleteAfter: new Date(Date.now() + 30 * HOUR).toISOString() };
  await context.route("**/api/backend/v1/**", async (route) => {
    const request = route.request();
    const where = `${request.method()} ${new URL(request.url()).pathname.replace("/api/backend", "")}`;
    if (where === "GET /v1/public/config") {
      return route.fulfill({ json: PUBLIC_CONFIG });
    }
    if (where === "POST /v1/experiences") {
      state.deleted = false;
      state.ended = false;
      return route.fulfill({ status: 201, json: { experienceId: "exp-1", memorySession: { ...memorySession, participantToken: "token-1" } } });
    }
    if (where === "GET /v1/experiences/exp-1") {
      state.experienceReads += 1;
      if (state.deleted) return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", requestId: "req-1" } } });
      return route.fulfill({ json: { memorySession: { ...memorySession, status: state.ended ? "ended" : "main" }, replayStatus: null, photoSummary: { ready: 0, pending: 0, failed: 0, maxCount: 12 } } });
    }
    if (where === "POST /v1/memory-sessions/mem-1/stop") {
      expect(request.headers().authorization).toBe("Bearer token-1");
      expect(request.postData()).toBeNull();
      state.stopKeys.push(request.headers()["idempotency-key"]);
      state.ended = true;
      return route.fulfill({ json: { status: "ended", stoppedAt: new Date().toISOString(), expiresAt: memorySession.expiresAt, deleteAfter: memorySession.deleteAfter } });
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
    // Only the developer screen's records may come here; a participant's photo would go up as `<record id>.jpg`.
    const id = /filename="([^"]+)\.jpg"/.exec(route.request().postDataBuffer()?.toString("latin1") ?? "")?.[1] ?? "record";
    state.uploads.push(id);
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
  await page.getByRole("button", { name: "次へ", exact: true }).click();
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

/** What this browser keeps in IndexedDB: photos tied to a participation, and anything else (the developer screen's records). */
const kept = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ photos: number; others: number }>((resolve, reject) => {
        const open = indexedDB.open("trace-ping-log");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction("entries", "readonly").objectStore("entries").getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const entries = request.result as { memorySessionId?: string }[];
            open.result.close();
            resolve({ photos: entries.filter((entry) => entry.memorySessionId).length, others: entries.filter((entry) => !entry.memorySessionId).length });
          };
        };
      }),
  );

/** A developer-screen record, which is no participation's and has to outlive one. */
const putDeveloperRecord = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("trace-ping-log");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("entries", "readwrite");
          const takenAt = new Date().toISOString();
          tx.objectStore("entries").put({ id: "developer-1", record: { kind: "ping", purpose: "accuracy", takenAt }, photo: null, sentAt: takenAt });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

test("closed registration never creates a local-only successful participation", async ({ context, page }) => {
  await standIn(context);
  await context.route("**/api/backend/v1/public/config", (route) => route.fulfill({
    json: { ...PUBLIC_CONFIG, registrationOpen: false },
  }));
  await page.goto("/log");
  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await expect(page.getByText(PUBLIC_CONFIG.consent.body, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByText("いまは参加を受け付けていません。", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("trace-consent"))).toBeNull();
  expect(await stored(page)).toEqual({ local: [], session: [] });
  await expect(page.getByRole("button", { name: "同意して参加する" })).toBeVisible();
});

test("a failed enrollment keeps the consent screen and reports the network error", async ({ context, page }) => {
  await standIn(context);
  await page.route("**/api/backend/v1/experiences", (route) => route.abort("connectionrefused"));
  await page.goto("/log");
  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByText(/サーバーにつながりませんでした/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("trace-consent"))).toBeNull();
  expect(await stored(page)).toEqual({ local: [], session: [] });
  await expect(page.getByRole("button", { name: "同意して参加する" })).toBeVisible();
});

test("changed backend consent must be displayed and explicitly agreed again, then remains readable after reload", async ({ context, page }) => {
  await standIn(context);
  await page.goto("/log");
  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await expect(page.getByText(PUBLIC_CONFIG.consent.body, { exact: true })).toBeVisible();
  const updated = { version: "consent-2", language: "ja", body: "改訂した参加説明です。写真は端末に保持し、選んだ場所と撮影時刻だけをサーバーに記録します。" };
  await context.route("**/api/backend/v1/public/config", (route) => route.fulfill({ json: { ...PUBLIC_CONFIG, consent: updated } }));
  await page.route("**/api/backend/v1/experiences", (route) => route.fulfill({
    status: 409, json: { error: { code: "CONSENT_VERSION_MISMATCH" } },
  }));
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByText(updated.body, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("trace-consent"))).toBeNull();
  expect(await stored(page)).toEqual({ local: [], session: [] });
  await page.unroute("**/api/backend/v1/experiences");
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("trace-consent")!))).toMatchObject(updated);
  await page.reload();
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.getByRole("button", { name: "同意した内容" }).click();
  await expect(page.getByText(updated.body, { exact: true })).toBeVisible();
});

test("unavailable public config cannot fall back to draft consent or local enrollment", async ({ context, page }) => {
  await standIn(context);
  await context.route("**/api/backend/v1/public/config", (route) => route.abort("connectionrefused"));
  await page.goto("/log");
  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("button", { name: "説明を読み込む" }).click();
  await expect(page.getByText(/サーバーにつながりませんでした/)).toBeVisible();
  await expect(page.getByRole("button", { name: "同意して参加する" })).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("trace-consent"))).toBeNull();
  expect(await stored(page)).toEqual({ local: [], session: [] });
});

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

test("terminal stop keeps photos and owner rights across tabs and reload, separately from deletion", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page);
  await page.getByRole("button", { name: "ホームへもどる" }).click();
  const credential = await page.evaluate(() => localStorage.getItem("trace-memory-credential"));
  const second = await context.newPage();
  await second.goto("/log");
  await expect(second.getByRole("button", { name: "写真を撮る" }).first()).toBeEnabled();
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.getByRole("button", { name: "記録を残して参加を終了", exact: true }).click();
  await page.getByRole("button", { name: "記録を残して終了する", exact: true }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeDisabled();
  await expect(second.getByRole("button", { name: "写真を撮る" }).first()).toBeDisabled();
  expect(backend.ended).toBe(true);
  expect(backend.deleted).toBe(false);
  expect(await kept(page)).toEqual({ photos: 1, others: 0 });
  expect(await page.evaluate(() => localStorage.getItem("trace-memory-credential"))).toBe(credential);
  await page.reload();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "QR コードを読み取る" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "作品を見る" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "1枚目の写真を保存" })).toBeVisible();
  await page.getByRole("button", { name: "メニュー" }).click();
  await expect(page.getByRole("button", { name: "記録を残して参加を終了", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "参加をやめる" }).click();
  await page.getByRole("button", { name: "やめて削除する" }).click();
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  expect(backend.deleted).toBe(true);
  expect(await kept(page)).toEqual({ photos: 0, others: 0 });
});

test("a failed stop leaves participation usable and retries with the same key", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  let first = true;
  const keys: string[] = [];
  await page.route("**/v1/memory-sessions/mem-1/stop", async (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (first) {
      first = false;
      return route.fulfill({ status: 503, json: { error: { code: "NETWORK" } } });
    }
    return route.fallback();
  });
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.getByRole("button", { name: "記録を残して参加を終了", exact: true }).click();
  await page.getByRole("button", { name: "記録を残して終了する", exact: true }).click();
  await expect(page.getByRole("alertdialog").getByRole("alert")).toContainText("サーバーにつながりませんでした");
  expect(backend.ended).toBe(false);
  await page.getByRole("button", { name: "記録を残して終了する", exact: true }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeDisabled();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});


test("a photo stays on the phone: no tab sends it anywhere, and both tabs show it", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  const second = await context.newPage();
  await second.goto("/log");
  await expect(second.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();

  await savePhoto(page);
  await expect(page.getByText("1枚目の写真を残しました")).toBeVisible({ timeout: 15000 });
  // The other tab hears of it without a reload, and a reload there sends nothing either.
  await expect(second.getByText("1枚（12枚まで）")).toBeAttached();
  await second.reload();
  await expect(second.getByText("1枚（12枚まで）")).toBeAttached();
  await second.waitForTimeout(2000);
  expect(backend.uploads).toEqual([]);
  expect(await kept(page)).toEqual({ photos: 1, others: 0 });
  await expect(page.getByText("未送信")).toHaveCount(0);
});

test("a participation the backend no longer knows is forgotten, with a note and the button to join again", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page);
  await expect(page.getByText("1枚目の写真を残しました")).toBeVisible({ timeout: 15000 });
  expect(await kept(page)).toEqual({ photos: 1, others: 0 });
  backend.deleted = true;
  await page.reload();
  // The note keeps 「はじめる」 and から together with a word joiner, so only its first sentences are matched.
  await expect(page.getByRole("status").filter({ hasText: "参加の記録が見つかりませんでした。期限が切れたか、削除されています。" })).toBeVisible();
  await shoot(page, "tabs-not-found");
  expect(await stored(page)).toEqual({ local: [], session: [] });
  // Its photos leave the phone with it.
  await expect.poll(() => kept(page)).toEqual({ photos: 0, others: 0 });
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
  await savePhoto(page);
  await expect(page.getByText("1枚目の写真を残しました")).toBeVisible({ timeout: 15000 });
  await putDeveloperRecord(page);
  expect(await kept(page)).toEqual({ photos: 1, others: 1 });
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
  // The participation's photos leave the phone; the developer screen's record stays.
  await expect.poll(() => kept(page)).toEqual({ photos: 0, others: 1 });
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
