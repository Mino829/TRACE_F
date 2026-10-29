import { expect, test, type BrowserContext, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * /log after arriving at ShibaLab (#14): the keepsake drawn from the photos
 * kept on the phone, each photo saved or deleted (#51) on its own, and
 * 振り返り3D (#50) from the keepsake. Like log-tabs.spec.ts,
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
    if (where === "DELETE /v1/memory-sessions/mem-1") return route.fulfill({ status: 204 });
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

/** Takes a photo and saves it at a place picked from the list: building, floor, place. */
async function savePhoto(page: Page, number: number, [building, floor, place] = ["本部棟", "5F", "本部棟5F"]) {
  await page.locator('input[type="file"][capture]').setInputFiles(PHOTO);
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await page.getByRole("button", { name: "一覧で選ぶ" }).click();
  await page.getByRole("radio", { name: building, exact: true }).click();
  await page.getByRole("radio", { name: floor, exact: true }).click();
  await page.getByRole("radio", { name: place }).click();
  await page.getByRole("button", { name: "ここで保存" }).click();
  await expect(page.getByText(`${number}枚目の写真を残しました`)).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "ホームへもどる" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
}

/** How many photos this browser keeps in IndexedDB. */
const kept = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("trace-ping-log");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction("entries", "readonly").objectStore("entries").count();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
  );

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

test("the TRACE mark leads to the title, which leads home without joining again; the developer button waits for ?dev", async ({ context, page }) => {
  const backend = await standIn(context);
  let joins = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/v1/experiences")) joins += 1;
  });
  await join(page);
  await savePhoto(page, 1);
  await expect(page.getByRole("button", { name: "開発者" })).toHaveCount(0);

  // From home: the title, whose foot leads back instead of to the consent.
  await page.getByRole("button", { name: "TRACE（タイトルへ）" }).click();
  await expect(page.getByRole("heading", { name: "撮った写真" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /はじめる/ })).toHaveCount(0);
  await page.getByRole("button", { name: "ホームへもどる" }).click();
  await expect(page.getByRole("button", { name: "1枚目の写真を保存" })).toBeVisible();

  // From the keepsake after arriving, the same.
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "あなたの作品" })).toBeVisible();
  await page.getByRole("button", { name: "TRACE（タイトルへ）" }).click();
  await expect(page.getByRole("heading", { name: "あなたの作品" })).toHaveCount(0);
  await page.getByRole("button", { name: "ホームへもどる" }).click();
  await expect(page.getByRole("button", { name: "作品を見る" })).toBeVisible();
  expect(joins).toBe(1);

  await page.goto("/log?dev");
  await expect(page.getByRole("button", { name: "開発者" })).toBeVisible();
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

test("a photo deletes after a question, from home before arriving and from the keepsake after; withdrawing leaves none on the phone", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  for (const number of [1, 2, 3]) await savePhoto(page, number);

  // Before arriving: from home's strip, after a question that can be cancelled.
  await page.getByRole("button", { name: "2枚目の写真を削除" }).click();
  await expect(page.getByRole("heading", { name: "2枚目の写真を削除しますか？" })).toBeVisible();
  await page.screenshot({ path: SHOTS ? path.join(SHOTS, "delete-ask.png") : undefined });
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByText("3枚（12枚まで）")).toBeAttached();
  expect(await kept(page)).toBe(3);
  await page.getByRole("button", { name: "2枚目の写真を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("heading", { name: "2枚目の写真を削除しますか？" })).toHaveCount(0);
  await expect(page.getByText("2枚（12枚まで）")).toBeAttached();
  expect(await kept(page)).toBe(2);

  // After arriving: from the keepsake, which is drawn again without it.
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("img", { name: /^作品。撮った2枚の写真/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "1枚目の写真を削除" }).click();
  await expect(page.getByText("作品からも外れます。")).toBeVisible();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("img", { name: /^作品。撮った1枚の写真/ })).toBeVisible({ timeout: 15000 });
  expect(await kept(page)).toBe(1);

  // Withdrawing deletes the participation on TRACE_B and every photo here.
  await page.getByRole("button", { name: "ホームへもどる" }).last().click();
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.getByRole("button", { name: "参加をやめる" }).click();
  await page.getByRole("button", { name: "やめて削除する" }).click();
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  // The title is up once TRACE_B has let go; the phone clears its photos just after.
  await expect.poll(() => kept(page)).toBe(0);
});

/** Where the photos' pins stand over the 3D view. */
const pinsAt = (page: Page) => page.locator(".trace__pin:not([hidden])").evaluateAll((pins) => pins.map((pin) => (pin as HTMLElement).style.transform));

test("振り返り3D draws the way from the photos' places to ShibaLab, turns by dragging, and lists the places in order", async ({ context, page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  await savePhoto(page, 2, ["研究棟", "7F", "研究棟7F 運河側"]);
  await savePhoto(page, 3, ["交流棟", "3F", "交流棟3F 食堂"]);
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await page.getByRole("button", { name: "軌跡を見る" }).click();
  await expect(page.getByRole("heading", { name: "あなたの軌跡" })).toBeVisible();

  // Each photo stands over the way, once the drawing code has loaded.
  await expect(page.locator(".trace__pin:not([hidden])")).toHaveCount(3, { timeout: 15000 });
  await expect(page.getByRole("status").filter({ hasText: "表示できないので" })).toHaveCount(0);
  const rows = page.locator(".trace__list li");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("1枚目");
  await expect(rows.nth(0)).toContainText("本部棟5F");
  await expect(rows.nth(1)).toContainText("研究棟7F 運河側");
  await expect(rows.nth(2)).toContainText("交流棟3F 食堂");
  await expect(rows.nth(3)).toContainText("ShibaLab（教室棟301）");
  await page.waitForTimeout(500);
  await shoot(page, "trace");

  // Dragging turns the view, and the pins move with it; 元の向きにもどす puts it back.
  const first = await pinsAt(page);
  const box = (await page.locator(".trace__canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  expect(await pinsAt(page)).not.toEqual(first);
  await page.getByRole("button", { name: "元の向きにもどす" }).click();
  await expect.poll(() => pinsAt(page)).toEqual(first);

  // A place in the list brings up its photo.
  await rows.nth(1).getByRole("button").click();
  await expect(page.locator(".trace__pick")).toContainText("研究棟7F 運河側");
  await expect(rows.nth(1).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: SHOTS ? path.join(SHOTS, "trace-pick.png") : undefined });

  await page.getByRole("button", { name: "作品にもどる" }).click();
  await expect(page.getByRole("heading", { name: "あなたの作品" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("without WebGL, 振り返り3D says so and still lists the places", async ({ context, page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind.includes("webgl") ? null : (getContext as (...args: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof getContext;
  });
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await page.getByRole("button", { name: "軌跡を見る" }).click();
  await expect(page.getByRole("status").filter({ hasText: "表示できないので" })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".trace__canvas")).toHaveCount(0);
  await expect(page.locator(".trace__list li")).toHaveCount(2);
  await shoot(page, "trace-off");
});
