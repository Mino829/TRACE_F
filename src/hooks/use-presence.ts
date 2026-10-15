"use client";

import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { ParticipantSession } from "@/lib/session";

export function usePresence(session: ParticipantSession | null, enabled: boolean, intervalSeconds: number) {
  const [message, setMessage] = useState("位置送信は一時停止中です。");
  const [accepted, setLastAccepted] = useState<{ sessionId: string; at: string; expiresAt: string; accuracy: number } | null>(null);
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const liveId = session?.livePresenceSession?.sessionId;
  const token = session?.livePresenceSession?.participantToken;
  const expiresAt = session?.livePresenceSession?.expiresAt;
  useEffect(() => {
    if (!enabled || !liveId || !token || !expiresAt) return;
    let watcher: number | undefined;
    let poller: ReturnType<typeof setInterval> | undefined;
    let controller: AbortController | null = null;
    let sentAt = 0;
    let recordedAt = 0;
    let terminated = false;
    let disposed = false;
    const clear = () => {
      if (watcher !== undefined) navigator.geolocation.clearWatch(watcher);
      watcher = undefined;
      if (poller !== undefined) clearInterval(poller);
      poller = undefined;
      controller?.abort();
      controller = null;
    };
    const sync = () => {
      clear();
      if (terminated || disposed) return;
      if (Date.parse(expiresAt) <= Date.now()) {
        terminated = true;
        setMessage("参加期限が終了しました。");
        return;
      }
      if (document.visibilityState !== "visible") {
        setMessage("画面を閉じている間は位置を送信しません。");
        return;
      }
      if (!navigator.onLine) {
        setMessage("オフラインです。接続後、新しく取得した位置を送信します。");
        return;
      }
      if (!window.isSecureContext || !navigator.geolocation) {
        setMessage("位置情報にはHTTPS接続、またはこの端末のlocalhostが必要です。");
        return;
      }
      setMessage("現在地を取得しています…");
      const receive = async (position: GeolocationPosition) => {
        if (disposed || terminated || document.visibilityState !== "visible" || !navigator.onLine || controller) return;
        if (Date.parse(expiresAt) <= Date.now()) { sync(); return; }
        if (Date.now() - sentAt < Math.max(1, intervalSeconds) * 1000 || position.timestamp <= recordedAt) return;
        sentAt = Date.now();
        recordedAt = position.timestamp;
        const current = new AbortController();
        controller = current;
        const timeout = setTimeout(() => current.abort(), 15000);
        setMessage("位置を送信しています…");
        try {
          const result = await api<{ latestRecordedAt: string; expiresAt: string }>(`/v1/live-presence-sessions/${liveId}/position`, {
            method: "POST", token, signal: current.signal,
            body: { point: { latitude: position.coords.latitude, longitude: position.coords.longitude,
              accuracyM: position.coords.accuracy, recordedAt: new Date(position.timestamp).toISOString() } },
          });
          if (!disposed && !current.signal.aborted) {
            setLastAccepted({ sessionId: liveId, at: result.latestRecordedAt, expiresAt: result.expiresAt, accuracy: position.coords.accuracy });
            setMessage("位置を送信しました。");
          }
        } catch (error) {
          if (!disposed && !current.signal.aborted) {
            setMessage(errorMessage(error));
            if (error instanceof ApiError && ["UNAUTHORIZED", "TRACKING_STOPPED", "NOT_FOUND"].includes(error.code)) {
              terminated = true;
              clear();
            }
          } else if (!disposed && document.visibilityState === "visible" && navigator.onLine && !terminated) {
            setMessage("送信を中断しました。次に取得した位置で再試行します。");
          }
        } finally {
          clearTimeout(timeout);
          if (controller === current) controller = null;
        }
      };
      const failure = (error: GeolocationPositionError) => {
        if (disposed || terminated || document.visibilityState !== "visible" || !navigator.onLine) return;
        setMessage(error.code === 1 ? "位置情報が許可されていません。ブラウザの設定で許可して、再度送信を開始してください。"
          : error.code === 3 ? "測位に時間がかかっています。開けた場所でお試しください。" : "現在地を取得できません。端末の位置情報設定を確認してください。");
        if (error.code === 1) { terminated = true; clear(); }
      };
      const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 };
      watcher = navigator.geolocation.watchPosition(receive, failure, options);
      // Stationary devices may not produce watch callbacks. Request a new fix;
      // never resend a queued or persisted coordinate to keep the presence alive.
      poller = setInterval(() => {
        if (!controller && !terminated && !disposed && document.visibilityState === "visible" && navigator.onLine) {
          navigator.geolocation.getCurrentPosition(receive, failure, options);
        }
      }, Math.max(1, intervalSeconds) * 1000);
    };
    const onLeave = () => { clear(); };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    window.addEventListener("pagehide", onLeave);
    window.addEventListener("pageshow", sync);
    const expiry = setTimeout(sync, Math.max(0, Date.parse(expiresAt) - Date.now()));
    sync();
    return () => {
      disposed = true;
      clear();
      clearTimeout(expiry);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("pageshow", sync);
    };
  }, [enabled, liveId, token, expiresAt, intervalSeconds]);

  const lastAccepted = accepted?.sessionId === liveId ? accepted : null;
  const fresh = session?.livePresenceSession?.trackingStatus === "tracking" && !!lastAccepted && Date.parse(lastAccepted.expiresAt) > clock;
  return { message: enabled ? message : "位置送信は一時停止中です。", lastAccepted, fresh, clock };
}
