import assert from "node:assert/strict";
import { test } from "node:test";

import { checkEntry } from "./environment.ts";

/** A phone with a camera API, in a tab, unless a case says otherwise. */
function check(userAgent, device = {}) {
  return checkEntry({ userAgent, maxTouchPoints: 0, standalone: false, camera: true, ...device });
}

const iphone = (os, version) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Mobile/15E148 Safari/604.1`;
const ipadAsMac = (version) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`;
const android = (chrome) =>
  `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Mobile Safari/537.36`;

test("iPhone Safari before iOS 16.4 cannot join", () => {
  assert.equal(check(iphone("16_3_1", "16.3")), "old");
  assert.equal(check(iphone("15_7", "15.6")), "old");
  assert.equal(check(iphone("12_5_7", "12.1.2")), "old");
  // Not even from the home screen.
  assert.equal(check(iphone("16_3", "16.3"), { standalone: true }), "old");
});

test("iPhone Safari from iOS 16.4 is told about the home screen in a tab, and joins from the icon", () => {
  assert.equal(check(iphone("16_4", "16.4")), "ios-browser");
  assert.equal(check(iphone("17_1_2", "17.1.2")), "ios-browser");
  assert.equal(check(iphone("16_4", "16.4"), { standalone: true }), "ok");
  assert.equal(check(iphone("17_1_2", "17.1.2"), { standalone: true }), "ok");
});

test("iOS 26 freezes the system version at 18.6 and is let through", () => {
  assert.equal(check(iphone("18_6", "26.0")), "ios-browser");
});

test("Chrome on iPhone goes by the iOS version, since it runs on Safari's engine", () => {
  const crios = (os) =>
    `Mozilla/5.0 (iPhone; CPU iPhone OS ${os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1`;
  assert.equal(check(crios("16_1")), "old");
  assert.equal(check(crios("17_0")), "ios-browser");
});

test("an iPad presenting itself as a Mac is told apart by touch and goes by its Safari version", () => {
  assert.equal(check(ipadAsMac("16.3"), { maxTouchPoints: 5 }), "old");
  assert.equal(check(ipadAsMac("17.0"), { maxTouchPoints: 5 }), "ios-browser");
  assert.equal(check(ipadAsMac("17.0"), { maxTouchPoints: 5, standalone: true }), "ok");
});

test("Android Chrome before 111 cannot join", () => {
  assert.equal(check(android(110)), "old");
  assert.equal(check(android(90)), "old");
});

test("Android Chrome from 111 joins", () => {
  assert.equal(check(android(111)), "ok");
  assert.equal(check(android(130)), "ok");
});

test("other Android browsers go by their engine's version", () => {
  const samsung = (chrome) =>
    `Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/${chrome}.0.0.0 Mobile Safari/537.36`;
  const firefox = (version) => `Mozilla/5.0 (Android 14; Mobile; rv:${version}.0) Gecko/${version}.0 Firefox/${version}.0`;
  assert.equal(check(samsung(108)), "old");
  assert.equal(check(samsung(115)), "ok");
  assert.equal(check(firefox(110)), "old");
  assert.equal(check(firefox(128)), "ok");
});

test("the browsers inside LINE, Instagram, X and Facebook cannot join", () => {
  const cases = [
    // LINE
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.17.0",
    "Mozilla/5.0 (Linux; Android 13; Pixel 7; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 Line/13.18.1/IAB",
    // Instagram
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21B80 Instagram 307.0.0.34.111 (iPhone15,2; iOS 17_1; ja_JP; ja; scale=3.00; 1179x2556; 532277761)",
    "Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 Instagram 312.1.0.34.111 Android (34/14; 480dpi; 1080x2340; samsung; SM-S911B; dm1q; qcom; ja_JP; 548323757)",
    // X
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 TwitterAndroid",
    // Facebook
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.0;FBSS/3;FBCR/;FBID/phone;FBLC/ja_JP;FBOP/5;FBAV/437.0.0.29.110]",
  ];
  for (const userAgent of cases) assert.equal(check(userAgent), "in-app", userAgent);
});

test("an in-app browser on an old iPhone is told the iPhone cannot join, not to move to Safari", () => {
  assert.equal(check("Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.17.0"), "old");
});

test("a browser with no camera to offer cannot join", () => {
  assert.equal(check(android(130), { camera: false }), "no-camera");
  assert.equal(check(iphone("17_1", "17.1"), { camera: false }), "no-camera");
});

test("a computer goes by its browser's version", () => {
  const windowsChrome = (chrome) =>
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Safari/537.36`;
  assert.equal(check(windowsChrome(130)), "ok");
  assert.equal(check(windowsChrome(109)), "old");
  // Playwright's own Chrome, which the end-to-end tests run in.
  assert.equal(check("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.6723.31 Safari/537.36"), "ok");
  assert.equal(check("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0"), "ok");
  // A Mac has no touch screen, so it is not taken for an iPad.
  assert.equal(check(ipadAsMac("17.0")), "ok");
  assert.equal(check(ipadAsMac("16.3")), "old");
  assert.equal(check(windowsChrome(130), { camera: false }), "no-camera");
});

test("a browser that cannot be read is let through", () => {
  assert.equal(check(""), "ok");
  assert.equal(check("Mozilla/5.0 (iPhone; CPU iPhone OS like Mac OS X)"), "ios-browser");
});
