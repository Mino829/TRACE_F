/**
 * Collects fixes for as long as a record is open.
 *
 * The watch runs while the person marks where they are and picks a photo, so
 * the window costs them no waiting and still shows how the fix settles. A
 * single low-accuracy request runs beside it: on most phones that is answered
 * from Wi-Fi and cell towers alone, which gives a network-only fix to set
 * against the watch's.
 */

import type { Capture, Fix } from "./record";

/** A record left open for minutes should not grow without end. */
const MAX_FIXES = 300;
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 };
const COARSE_OPTIONS: PositionOptions = { enableHighAccuracy: false, maximumAge: 0, timeout: 15000 };

function toFix(position: GeolocationPosition): Fix {
  const { coords } = position;
  return {
    receivedAt: Date.now(),
    timestamp: position.timestamp,
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: coords.accuracy,
    altitude: coords.altitude,
    altitudeAccuracy: coords.altitudeAccuracy,
    heading: coords.heading,
    speed: coords.speed,
  };
}

export function geolocationMessage(code: number): string {
  if (code === 1) return "位置情報が許可されていません。端末の設定で、このページ（またはブラウザ）に位置情報を許可してください。";
  if (code === 3) return "位置情報の取得に時間がかかっています。";
  return "位置情報を取得できませんでした。";
}

export type CaptureHandle = {
  /** Stops listening and returns everything collected. */
  stop: () => Capture;
};

export function startCapture(onChange: (capture: Capture) => void): CaptureHandle {
  const capture: Capture = { startedAt: Date.now(), endedAt: null, options: WATCH_OPTIONS, fixes: [], coarse: null, coarseError: null, errors: [] };
  const publish = () => onChange({ ...capture, fixes: [...capture.fixes], errors: [...capture.errors] });
  let stopped = false;

  if (!("geolocation" in navigator)) {
    capture.errors.push({ at: Date.now(), code: 2, message: "この端末では位置情報を使えません。" });
    publish();
    return { stop: () => ({ ...capture, endedAt: Date.now() }) };
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      if (stopped || capture.fixes.length >= MAX_FIXES) return;
      capture.fixes.push(toFix(position));
      publish();
    },
    (error) => {
      if (stopped) return;
      capture.errors.push({ at: Date.now(), code: error.code, message: error.message });
      publish();
    },
    WATCH_OPTIONS,
  );
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (stopped) return;
      capture.coarse = toFix(position);
      publish();
    },
    (error) => {
      if (stopped) return;
      capture.coarseError = `${error.code}: ${error.message}`;
      publish();
    },
    COARSE_OPTIONS,
  );

  return {
    stop: () => {
      if (!stopped) {
        stopped = true;
        navigator.geolocation.clearWatch(watchId);
        capture.endedAt = Date.now();
      }
      return { ...capture, fixes: [...capture.fixes], errors: [...capture.errors] };
    },
  };
}
