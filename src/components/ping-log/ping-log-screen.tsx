"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { clearConsent, loadConsent, saveConsent, type Consent } from "@/lib/ping-log/consent";
import {
  PUSH_API_URL,
  deviceId,
  dropExpired,
  forgetMe,
  sendTestPing,
  subscribe,
  subscriptionExpiresAt,
  unsubscribe,
  uploadEntry,
} from "@/lib/ping-log/push";
import { clearEntries, listEntries, putEntry, type LogEntry } from "@/lib/ping-log/store";

import { ConsentView } from "./consent-view";
import { DeveloperView } from "./developer-view";
import { RecordCard } from "./record-card";
import { CARD, LINK, PRIMARY, SECONDARY, clock } from "./ui";

const PING_INTERVAL_MINUTES = 10;
const PENDING_KEY = "trace-ping-pending";
const VIEW_KEY = "trace-log-view";
const OUTSIDE_KEY = "trace-allow-outside";
const PROMPT_MESSAGE = "trace-ping";

type View = "participant" | "developer";

/** The ping waiting for an answer: from the notification that opened the page, or one left over from before. */
function initialPending(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("prompt");
  if (fromUrl && !Number.isNaN(Date.parse(fromUrl))) {
    savePending(fromUrl);
    return fromUrl;
  }
  return read(window.localStorage, PENDING_KEY);
}

function savePending(value: string | null): void {
  write(window.localStorage, PENDING_KEY, value);
}

function read(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Private mode: it lasts as long as the page.
  }
}

function notificationState(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" || !("PushManager" in window) ? "unsupported" : Notification.permission;
}

/** The worker's cron fires on every tenth minute of the hour. */
function nextPingAt(now: number): number {
  const step = PING_INTERVAL_MINUTES * 60 * 1000;
  return Math.floor(now / step) * step + step;
}

function isToday(value: string): boolean {
  return new Date(value).toDateString() === new Date().toDateString();
}

export function PingLogScreen() {
  // The participant screen is what opens by default; the developer screen lasts for this tab only.
  const [view, setView] = useState<View>(() => (read(window.sessionStorage, VIEW_KEY) === "developer" ? "developer" : "participant"));
  const [consent, setConsent] = useState<Consent | null>(loadConsent);
  const [readingConsent, setReadingConsent] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(subscriptionExpiresAt);
  const [pendingAt, setPendingAt] = useState<string | null>(initialPending);
  const [manual, setManual] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [permission, setPermission] = useState(notificationState);
  const [geolocation, setGeolocation] = useState<PermissionState | "unknown" | null>(null);
  const [allowOutside, setAllowOutside] = useState(() => read(window.localStorage, OUTSIDE_KEY) === "1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const prompt = useCallback((value: string | null) => {
    savePending(value);
    setPendingAt(value);
  }, []);

  /** Sends every record the worker has not acknowledged yet; the rest wait for the next try. */
  const sendUnsent = useCallback(async (): Promise<number> => {
    if (!PUSH_API_URL) return 0;
    let failed = 0;
    for (const entry of (await listEntries()).filter((item) => !item.sentAt)) {
      try {
        await uploadEntry(entry);
        await putEntry({ ...entry, sentAt: new Date().toISOString() });
      } catch {
        failed += 1;
      }
    }
    setEntries(await listEntries());
    return failed;
  }, []);

  useEffect(() => {
    // The prompt is in localStorage now; a reload should not bring back an answered one.
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
    listEntries()
      .then((items) => {
        setEntries(items);
        return sendUnsent();
      })
      .catch(() => setMessage("記録を読み込めませんでした。"));
    (navigator.permissions ? navigator.permissions.query({ name: "geolocation" }) : Promise.reject(new Error("no Permissions API")))
      .then((status) => {
        setGeolocation(status.state);
        status.onchange = () => setGeolocation(status.state);
      })
      .catch(() => setGeolocation("unknown"));
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/ping-sw.js", { scope: "/" })
      .then(async (registration) => {
        registrationRef.current = registration;
        if (!("pushManager" in registration)) return;
        const current = await registration.pushManager.getSubscription();
        const expiry = subscriptionExpiresAt();
        // The worker stopped pinging at midnight; the phone should stop claiming otherwise.
        if (current && expiry && Date.parse(expiry) <= Date.now()) {
          await dropExpired(current);
          setExpiresAt(null);
          setSubscription(null);
        } else {
          setSubscription(current);
        }
      })
      .catch(() => setMessage("通知の準備に失敗しました。"));
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === PROMPT_MESSAGE) prompt(event.data.promptedAt);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [prompt, sendUnsent]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const subscribed = subscription !== null && (!expiresAt || Date.parse(expiresAt) > now);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await task();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "うまくいきませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const switchView = (next: View) => {
    write(window.sessionStorage, VIEW_KEY, next === "developer" ? next : null);
    setView(next);
    setMessage("");
  };

  const agree = () => {
    setConsent(saveConsent());
    setMessage("");
  };

  const start = () => run(async () => {
    if (!consent) return;
    if (notificationState() === "unsupported") throw new Error("このブラウザでは通知を受け取れません。iPhone は、共有ボタンから「ホーム画面に追加」をして、追加したアイコンから開いてください。");
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") throw new Error("通知が許可されていません。端末の設定で許可してください。");
    const registration = registrationRef.current ?? (await navigator.serviceWorker.ready);
    setSubscription(await subscribe(registration, consent.version));
    setExpiresAt(subscriptionExpiresAt());
    // Ask for location now, while the person is looking, rather than at the first record.
    navigator.geolocation?.getCurrentPosition(() => undefined, () => undefined, { maximumAge: Infinity, timeout: 30000 });
    setMessage(`通知を開始しました。${PING_INTERVAL_MINUTES}分ごとに通知が届きます。`);
  });

  const stop = () => run(async () => {
    if (!subscription) return;
    await unsubscribe(subscription);
    setSubscription(null);
    setExpiresAt(null);
    setMessage("通知を停止しました。");
  });

  const test = () => run(async () => {
    if (!subscription) return;
    await sendTestPing(subscription);
    setMessage("テスト通知を送りました。数秒で届きます。");
  });

  const save = async (entry: LogEntry) => {
    await putEntry(entry);
    if (entry.record.kind === "ping") prompt(null);
    setManual(false);
    const failed = await sendUnsent();
    setMessage(!PUSH_API_URL ? "この端末に記録されました。" : failed ? "記録されましたが、送信できませんでした。次に開いたときに再送します。" : "記録を送信しました。ご協力ありがとうございます。");
  };

  const closeRecord = () => {
    if (manual) setManual(false);
    else prompt(null);
  };

  const withdraw = () => run(async () => {
    if (!window.confirm("通知を止め、この端末から送ったデータをすべて削除します。よろしいですか？")) return;
    if (subscription) await unsubscribe(subscription).catch(() => subscription.unsubscribe());
    const deleted = PUSH_API_URL ? await forgetMe() : 0;
    await clearEntries();
    clearConsent();
    prompt(null);
    setSubscription(null);
    setExpiresAt(null);
    setEntries([]);
    setConsent(null);
    setMessage(`参加をやめました。送られたデータ ${deleted}件を削除しました。`);
  });

  const resend = () => run(async () => {
    const failed = await sendUnsent();
    setMessage(failed ? `${failed}件を送信できませんでした。` : "未送信の記録を送りました。");
  });

  const exportLocal = () => {
    const blob = new Blob([JSON.stringify(entries.map(({ record, sentAt }) => ({ ...record, sentAt })), null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `trace-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const clearLocal = () => run(async () => {
    if (!window.confirm("この端末に残っている記録を削除します。送信済みのデータはサーバーに残ります。よろしいですか？")) return;
    await clearEntries();
    setEntries([]);
  });

  const changeAllowOutside = (value: boolean) => {
    write(window.localStorage, OUTSIDE_KEY, value ? "1" : null);
    setAllowOutside(value);
  };

  const active = consent && (manual || pendingAt) ? { kind: manual ? ("manual" as const) : ("ping" as const), promptedAt: manual ? null : pendingAt } : null;
  const recordCard = active && consent && geolocation !== null && (
    <RecordCard
      key={`${active.kind}-${active.promptedAt}`}
      kind={active.kind}
      promptedAt={active.promptedAt}
      consent={consent}
      developer={view === "developer"}
      allowOutside={view === "developer" && allowOutside}
      autoStart={active.kind === "manual" || geolocation === "granted"}
      onSave={save}
      onClose={closeRecord}
    />
  );
  const status = (busy || message) && <p className="text-sm" role="status">{busy ? "処理しています…" : message}</p>;
  const todayCount = entries.filter((entry) => isToday(entry.record.takenAt)).length;
  const unsent = entries.filter((entry) => !entry.sentAt).length;

  return (
    <main className="mx-auto w-full max-w-md space-y-6 px-4 py-8">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">定期ログ</h1>
          {view === "developer" && <p className="text-sm text-neutral-500">開発者向け</p>}
        </div>
        <button type="button" className="shrink-0 rounded-md border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700" onClick={() => switchView(view === "developer" ? "participant" : "developer")}>
          {view === "developer" ? "参加者向け" : "開発者向け"}
        </button>
      </header>

      {!PUSH_API_URL && (
        <p className="rounded-lg border border-neutral-300 p-4 text-sm dark:border-neutral-700">
          通知サーバーの URL が設定されていません。NEXT_PUBLIC_PUSH_API_URL を設定してください。
        </p>
      )}

      {view === "developer" ? (
        <>
          {recordCard}
          {status}
          <DeveloperView
            apiUrl={PUSH_API_URL}
            deviceId={deviceId()}
            consent={consent}
            notificationPermission={permission}
            geolocationPermission={geolocation}
            subscription={subscribed ? subscription : null}
            expiresAt={expiresAt}
            nextPingAt={nextPingAt(now)}
            allowOutside={allowOutside}
            entries={entries}
            busy={busy}
            onAllowOutside={changeAllowOutside}
            onTest={() => void test()}
            onRecordNow={() => setManual(true)}
            onResend={() => void resend()}
            onExport={exportLocal}
            onClearLocal={() => void clearLocal()}
          />
        </>
      ) : !consent ? (
        <>
          <p className="text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            {PING_INTERVAL_MINUTES}分ごとにスマホに通知が届きます。通知が届いたら、いまいる場所を記録してください。写真を添えることもできます。
          </p>
          <ConsentView onAgree={agree} />
          {status}
        </>
      ) : readingConsent ? (
        <ConsentView onClose={() => setReadingConsent(false)} />
      ) : (
        <>
          {recordCard}

          <section className={CARD}>
            {subscribed ? (
              <div>
                <p className="text-sm text-neutral-500">通知を受け取っています</p>
                <p className="text-3xl font-bold tabular-nums">{clock(nextPingAt(now))}</p>
                <p className="text-sm text-neutral-500">ごろに次の通知が届きます。画面が消えていても届きます。</p>
                <p className="mt-2 text-xs text-neutral-500">通知はその日の24時に自動で止まります。</p>
              </div>
            ) : (
              <p className="text-sm text-neutral-500">通知は停止中です。</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {subscribed ? (
                <button type="button" className={SECONDARY} onClick={() => void stop()} disabled={busy}>通知を停止する</button>
              ) : (
                <button type="button" className={PRIMARY} onClick={() => void start()} disabled={busy || !PUSH_API_URL}>通知を開始する</button>
              )}
              <button type="button" className={SECONDARY} onClick={() => setManual(true)} disabled={busy || active !== null}>今すぐ記録する</button>
            </div>
            {permission === "denied" && <p className="text-xs text-neutral-500">通知がオフになっています。端末の設定で許可してください。</p>}
            {permission === "unsupported" && (
              <p className="text-xs text-neutral-500">このブラウザでは通知を受け取れません。iPhone は、共有ボタンから「ホーム画面に追加」をして、追加したアイコンから開いてください。</p>
            )}
          </section>

          {status}

          <section className="space-y-1 text-sm">
            <p>今日の記録 {todayCount}件</p>
            {unsent > 0 && (
              <p className="text-neutral-500">
                未送信 {unsent}件。電波のよい場所で開くと送信されます。
                <button type="button" className={`${LINK} ml-2`} onClick={() => void resend()} disabled={busy}>いま送る</button>
              </p>
            )}
          </section>

          <footer className="flex gap-4 border-t border-neutral-200 pt-4 dark:border-neutral-800">
            <button type="button" className={LINK} onClick={() => setReadingConsent(true)}>同意した内容を見る</button>
            <button type="button" className={LINK} onClick={() => void withdraw()} disabled={busy}>参加をやめる</button>
          </footer>
        </>
      )}
    </main>
  );
}
