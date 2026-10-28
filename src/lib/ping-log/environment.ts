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

/**
 * Whether this phone and browser can join, checked on the title before
 * 「はじめる」.
 *
 * - ok: join as usual.
 * - old: older than iOS 16.4, or than the Chrome, Firefox or Safari that
 *   Next.js 16 supports (111, 111 and 16.4). The page would break partway, so
 *   joining stops on the title.
 * - in-app: the browser inside LINE, Instagram, X or Facebook. What it saves
 *   is not shared with Safari or Chrome, so a participation started here
 *   could not be carried on there; it has to be opened in Safari or Chrome.
 * - no-camera: the browser has no camera to offer at all. The camera is the
 *   one condition of joining (it reads the QR code at ShibaLab); its
 *   permission is asked when it is first used, not here.
 * - ios-browser: an iPhone or iPad in a browser tab, where notifications never
 *   arrive. Starting from the home screen is suggested; joining in the tab,
 *   without them, is allowed.
 */
export type EntryCheck = "ok" | "old" | "in-app" | "no-camera" | "ios-browser";

export type EntryDevice = {
  userAgent: string;
  /** iPadOS Safari presents itself as a Mac; a touch screen tells them apart. */
  maxTouchPoints: number;
  /** Opened from the home-screen icon. */
  standalone: boolean;
  /** navigator.mediaDevices.getUserMedia exists. */
  camera: boolean;
};

type Version = [major: number, minor: number];

function readVersion(userAgent: string, pattern: RegExp): Version | null {
  const match = pattern.exec(userAgent);
  return match ? [Number(match[1]), Number(match[2] ?? 0)] : null;
}

/** A version that cannot be read is let through: only a known old one stops anyone. */
function olderThan(version: Version | null, [major, minor]: Version): boolean {
  return version !== null && (version[0] < major || (version[0] === major && version[1] < minor));
}

function tooOld(userAgent: string, ios: boolean, iPadAsMac: boolean): boolean {
  // Every browser on iOS is Safari's engine, so the system's version is the one that counts.
  if (ios) return olderThan(readVersion(userAgent, iPadAsMac ? /Version\/(\d+)(?:\.(\d+))?/ : / OS (\d+)(?:_(\d+))?\S* like Mac OS X/), [16, 4]);
  const chrome = readVersion(userAgent, /Chrome\/(\d+)/);
  if (chrome) return olderThan(chrome, [111, 0]);
  const firefox = readVersion(userAgent, /Firefox\/(\d+)/);
  if (firefox) return olderThan(firefox, [111, 0]);
  return /Safari\//.test(userAgent) && olderThan(readVersion(userAgent, /Version\/(\d+)(?:\.(\d+))?/), [16, 4]);
}

export function checkEntry({ userAgent, maxTouchPoints, standalone, camera }: EntryDevice): EntryCheck {
  const iPadAsMac = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  const ios = /iPhone|iPad|iPod/.test(userAgent) || iPadAsMac;
  if (tooOld(userAgent, ios, iPadAsMac)) return "old";
  if (IN_APP.test(userAgent)) return "in-app";
  if (!camera) return "no-camera";
  if (ios && !standalone) return "ios-browser";
  return "ok";
}

export function entryCheck(): EntryCheck {
  return checkEntry({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: isStandalone(),
    camera: typeof navigator.mediaDevices?.getUserMedia === "function",
  });
}
