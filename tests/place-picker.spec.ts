import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

/**
 * The place step of the photo flow: after a photo is taken the participant
 * chooses where it was taken (building, floor, checkpoint), for every photo,
 * the same place as often as they like. No position is read from the phone.
 */

const PHOTO = path.join(__dirname, "..", "models", "renders", "01_全体_南東の空から.jpg");
const SHOTS = process.env.TRACE_TEST_SHOTS;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, geolocation: undefined, permissions: [] });

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

async function takePhoto(page: Page) {
  await page.locator('input[type="file"][capture]').setInputFiles(PHOTO);
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await expect(page.getByRole("heading", { name: /どこで撮りましたか/ })).toBeVisible();
}

/** The map is tapped by eye; the tests choose through the list, which offers the same choice. */
async function useList(page: Page) {
  await page.getByRole("button", { name: "一覧で選ぶ" }).click();
}

test("a photo saves its chosen checkpoint without requesting the phone's position or location permission", async ({ page }) => {
  await page.addInitScript(() => {
    const locationCalls: string[] = [];
    Object.defineProperty(window, "__locationCalls", { value: locationCalls, configurable: true });
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = () => { locationCalls.push("getCurrentPosition"); throw new Error("location disabled"); };
      navigator.geolocation.watchPosition = () => { locationCalls.push("watchPosition"); throw new Error("location disabled"); };
    }
    if (navigator.permissions) {
      const original = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (descriptor) => {
        if (descriptor.name === "geolocation") locationCalls.push("permission query");
        return original(descriptor);
      };
    }
  });
  await join(page);
  await takePhoto(page);
  await page.waitForTimeout(1500);
  await shoot(page, "01-opened");
  await useList(page);

  const save = page.getByRole("button", { name: "ここで保存" });
  await expect(save).toBeDisabled();

  await page.getByRole("radio", { name: "研究棟", exact: true }).click();
  await page.getByRole("radio", { name: "9F", exact: true }).click();
  await shoot(page, "02-kenkyu-9f");
  await page.getByRole("radio", { name: /研究棟9F 教室棟側/ }).click();
  await expect(save).toBeEnabled();
  await shoot(page, "03-selected");
  await save.click();
  await expect(page.getByText("1枚目の写真を残しました")).toBeVisible();
  await shoot(page, "04-clear");

  expect(await page.evaluate(() => Reflect.get(window, "__locationCalls"))).toEqual([]);

  const stored = await page.evaluate(
    () =>
      new Promise<{ place: unknown; fixes: number; schema: number }[]>((resolve, reject) => {
        const open = indexedDB.open("trace-ping-log");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction("entries").objectStore("entries").getAll();
          request.onsuccess = () =>
            resolve((request.result as { record: { place: unknown; capture: { fixes: unknown[] }; schema: number } }[]).map((entry) => ({ place: entry.record.place, fixes: entry.record.capture.fixes.length, schema: entry.record.schema })));
          request.onerror = () => reject(request.error);
        };
      }),
  );
  expect(stored).toHaveLength(1);
  expect(stored[0].fixes).toBe(0);
  expect(stored[0].schema).toBe(3);
  expect(stored[0].place).toMatchObject({ checkpointId: "research-9f", building: "kenkyu", floor: "9F" });
});

test("the next photo opens on the last place and can take it again in one tap", async ({ page }) => {
  await join(page);
  await takePhoto(page);
  await useList(page);
  await page.getByRole("radio", { name: "本部棟", exact: true }).click();
  await page.getByRole("radio", { name: "5F", exact: true }).click();
  await page.getByRole("radio", { name: /本部棟5F/ }).click();
  await page.getByRole("button", { name: "ここで保存" }).click();
  await expect(page.getByText("1枚目の写真を残しました")).toBeVisible();
  await page.getByRole("button", { name: "ホームへもどる" }).click();

  await page.getByRole("button", { name: "写真を撮る" }).first().click({ trial: true }).catch(() => undefined);
  await takePhoto(page);
  await shoot(page, "05-second-photo");
  await page.getByRole("button", { name: /前回の場所/ }).click();
  await expect(page.getByRole("button", { name: "ここで保存" })).toBeEnabled();
  await page.getByRole("button", { name: "ここで保存" }).click();
  await expect(page.getByText("2枚目の写真を残しました")).toBeVisible();
});

test("the list offers every building, floor and checkpoint without the map", async ({ page }) => {
  await join(page);
  await takePhoto(page);
  await useList(page);
  await page.getByRole("radio", { name: "交流棟", exact: true }).click();
  await page.getByRole("radio", { name: "3F", exact: true }).click();
  await page.getByRole("radio", { name: /交流棟3F/ }).click();
  await expect(page.getByRole("button", { name: "ここで保存" })).toBeEnabled();
  await page.getByRole("button", { name: "地図で選ぶ" }).click();
  await expect(page.getByRole("button", { name: "ここで保存" })).toBeEnabled();
  await page.getByRole("button", { name: "写真にもどる" }).click();
  await expect(page.getByRole("button", { name: "次へ", exact: true })).toBeVisible();
});

/** Fingers through the browser's own touch input, so the map's handling of pointers is what is tested. */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  type Point = [number, number];
  const send = (type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", points: Point[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const centre = async (selector: string): Promise<Point> => {
    const box = await page.locator(selector).first().boundingBox();
    if (!box) throw new Error(`${selector} is not on screen`);
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  return {
    centre,
    async tap(point: Point) {
      await send("touchStart", [point]);
      await send("touchEnd", []);
    },
    /** One or more fingers down and moved together by (dx, dy) in steps, still down: what is returned lifts them. */
    async hold(points: Point[], dx: number, dy: number) {
      await send("touchStart", points);
      for (let i = 1; i <= 8; i++) await send("touchMove", points.map(([x, y]) => [x + (dx * i) / 8, y + (dy * i) / 8] as Point));
      return () => send("touchEnd", []);
    },
    /** One or more fingers down, moved together by (dx, dy) in steps, then lifted. */
    async drag(points: Point[], dx: number, dy: number, hold = 0) {
      const lift = await this.hold(points, dx, dy);
      if (hold) await page.waitForTimeout(hold);
      await lift();
    },
    /** A finger down on one point, slid to another, lifted. */
    async slide(from: Point, to: Point) {
      await send("touchStart", [from]);
      for (let i = 1; i <= 6; i++) await send("touchMove", [[from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6]]);
      await send("touchEnd", []);
    },
  };
}

test("on the map, a building opens on its floors with nothing chosen, and a stray touch picks nothing", async ({ page }) => {
  await join(page);
  await takePhoto(page);
  const finger = await fingers(page);
  const save = page.getByRole("button", { name: "ここで保存" });
  const crumbs = page.getByRole("navigation", { name: "地図の段階" });
  const tag = '.cm__building[aria-label="教室棟を開く"]';
  await expect(page.locator(tag)).toBeVisible();
  await page.waitForTimeout(500);
  const stage = await page.locator(".cm__stage").boundingBox();
  if (!stage) throw new Error("no map");
  const middle: [number, number] = [stage.x + stage.width / 2, stage.y + stage.height / 2];
  // The places outside are dots until one is touched.
  await expect(page.locator('.cm__spot[data-on="true"]')).toHaveCount(0);

  // Two fingers (a pinch, a two-finger swipe) pick nothing; a drag from a name, any way, turns or tilts the map instead of opening it.
  await finger.drag([[middle[0] - 60, middle[1]], [middle[0] + 60, middle[1]]], 0, 0);
  await finger.drag([[middle[0] - 60, middle[1]], [middle[0] + 60, middle[1]]], 120, 0);
  const before = await finger.centre(tag);
  await finger.drag([before], 0, 80, 200);
  await page.waitForTimeout(300);
  expect(Math.abs((await finger.centre(tag))[1] - before[1])).toBeGreaterThan(10);
  await finger.drag([await finger.centre(tag)], 130, 0, 200);
  await page.waitForTimeout(600);
  await expect(crumbs).toHaveCount(0);
  await expect(save).toBeDisabled();

  // When a drag stops, the names with room stay where they were while the map moved; one that must move glides there.
  type Shown = { text: string; x: number; y: number; glide: boolean };
  const names = () =>
    page.locator(".cm__labels [data-on=true]").evaluateAll((els) =>
      els.map((el) => ({ text: el.textContent ?? "", x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), glide: (el as HTMLElement).style.transition.includes("transform") })),
    );
  const lift = await finger.hold([middle], -130, -80);
  await page.waitForTimeout(200);
  const held: Shown[] = await names();
  await lift();
  await page.waitForTimeout(500);
  const after: Shown[] = await names();
  const moved = after.filter((name) => held.some((was) => was.text === name.text && (was.x !== name.x || was.y !== name.y)));
  expect(moved.length).toBeLessThan(after.length);
  for (const name of moved) expect(name.glide, `${name.text} jumped`).toBe(true);

  // The building opens on its floors; none is opened and nothing is chosen by itself.
  await finger.tap(await finger.centre(tag));
  await expect(crumbs).toContainText("教室棟");
  await expect(page.getByRole("button", { name: /教室棟 \dF/ })).toHaveCount(8);
  await expect(page.getByRole("button", { name: /教室棟 \dF/, pressed: true })).toHaveCount(0);
  await expect(save).toBeDisabled();
  await shoot(page, "06-map-building");

  // Sliding along the rail from 6F and letting go on 3F opens 3F.
  await page.waitForTimeout(500);
  await finger.slide(await finger.centre('button[aria-label="教室棟 6F"]'), await finger.centre('button[aria-label="教室棟 3F"]'));
  await expect(crumbs).toContainText("3F");
  await expect(page.getByRole("button", { name: "教室棟 3F", pressed: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await page.waitForTimeout(600);

  // A tap off the floor leaves it as it is; a tap on a place picks it.
  await finger.tap([stage.x + 12, stage.y + stage.height - 12]);
  await expect(crumbs).toContainText("3F");
  await expect(save).toBeDisabled();
  await finger.tap(await finger.centre('.cm__spot[data-on="true"]'));
  await expect(save).toBeEnabled();
  await shoot(page, "07-map-floor");

  // Back to the whole campus by the crumbs; the choice stays.
  await page.getByRole("button", { name: "キャンパス", exact: true }).click();
  await expect(crumbs).toHaveCount(0);
  await expect(save).toBeEnabled();
});

test("on the whole campus a place outside is named only once its dot is tapped, which picks it", async ({ page }) => {
  await join(page);
  await takePhoto(page);
  const finger = await fingers(page);
  const crumbs = page.getByRole("navigation", { name: "地図の段階" });
  const named = page.locator('.cm__spot[data-on="true"]');
  await expect(page.locator('.cm__building[aria-label="教室棟を開く"]')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(named).toHaveCount(0);

  // Tap round the ground until a dot is hit; a building opened on the way is closed again.
  const stage = await page.locator(".cm__stage").boundingBox();
  if (!stage) throw new Error("no map");
  let found = false;
  for (let y = stage.y + 60; y < stage.y + stage.height - 20 && !found; y += 22) {
    for (let x = stage.x + 14; x < stage.x + stage.width - 14 && !found; x += 22) {
      await finger.tap([x, y]);
      if (await crumbs.count()) {
        await page.getByRole("button", { name: "キャンパス", exact: true }).click();
        continue;
      }
      found = (await page.locator('.cm__spot[aria-pressed="true"][data-on="true"]').count()) === 1;
    }
  }
  expect(found).toBe(true);
  await expect(named).toHaveCount(1);
  await expect(page.locator(".pp-summary")).toHaveText((await named.textContent()) ?? "");
  await expect(page.getByRole("button", { name: "ここで保存" })).toBeEnabled();
  await shoot(page, "08-map-outdoor");
});

test("the phone's back button steps back from the place screen to the photo and keeps the photo", async ({ page }) => {
  await join(page);
  await takePhoto(page);
  await page.goBack();
  await expect(page.getByRole("button", { name: "次へ", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await expect(page.getByRole("heading", { name: /どこで撮りましたか/ })).toBeVisible();
});
