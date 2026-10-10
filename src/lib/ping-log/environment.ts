/**
 * What this browser can do about notifications, so the setup can say exactly
 * what to do instead of a generic "not supported".
 *
 * - supported: Web Push works here.
 * - ios-browser: an iPhone or iPad in a Safari tab. Push only works once the
 *   page is added to the home screen and opened from there (iOS 16.4 and later).
 * - in-app: the browser inside LINE, Instagram, X or Facebook, where push never
 *   works; the page has to be opened in Safari or Chrome.
 * - unsupported: anything else without push.
 */
export type PushSupport = "supported" | "ios-browser" | "in-app" | "unsupported";

const IN_APP = /\bLine\/|FBAN|FBAV|Instagram|Twitter|MicroMessenger/i;

export function isIos(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupport(): PushSupport {
  if (IN_APP.test(navigator.userAgent)) return "in-app";
  if (typeof Notification !== "undefined" && "PushManager" in window && "serviceWorker" in navigator) return "supported";
  if (isIos() && !isStandalone()) return "ios-browser";
  return "unsupported";
}
