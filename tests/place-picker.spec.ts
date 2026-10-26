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
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
}

async function takePhoto(page: Page) {
  await page.locator('input[type="file"][capture]').setInputFiles(PHOTO);
  await page.getByRole("button", { name: "場所を選ぶ" }).click();
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
  await expect(page.getByText("1枚目のメモリーを残しました")).toBeVisible();
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
  await expect(page.getByText("1枚目のメモリーを残しました")).toBeVisible();
  await page.getByRole("button", { name: "ホームへもどる" }).click();

  await page.getByRole("button", { name: "写真を撮る" }).first().click({ trial: true }).catch(() => undefined);
  await takePhoto(page);
  await shoot(page, "05-second-photo");
  await page.getByRole("button", { name: /さっきと同じ/ }).click();
  await expect(page.getByRole("button", { name: "ここで保存" })).toBeEnabled();
  await page.getByRole("button", { name: "ここで保存" }).click();
  await expect(page.getByText("2枚目のメモリーを残しました")).toBeVisible();
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
  await expect(page.getByRole("button", { name: "場所を選ぶ" })).toBeVisible();
});

test("the phone's back button steps back from the place screen to the photo and keeps the photo", async ({ page }) => {
  await join(page);
  await takePhoto(page);
  await page.goBack();
  await expect(page.getByRole("button", { name: "場所を選ぶ" })).toBeVisible();
  await page.getByRole("button", { name: "場所を選ぶ" }).click();
  await expect(page.getByRole("heading", { name: /どこで撮りましたか/ })).toBeVisible();
});
