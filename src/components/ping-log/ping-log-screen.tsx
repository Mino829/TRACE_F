"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { clearConsent, loadConsent, saveConsent, type Consent } from "@/lib/ping-log/consent";
import { pushSupport, type PushSupport } from "@/lib/ping-log/environment";
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

import { ConsentDialog } from "./consent-view";
import { DeveloperView } from "./developer-view";
import { HomeView, type SetupStatus } from "./home-view";
import { HowToDialog } from "./how-to-play";
import { PixelScene, phaseAt } from "./pixel-scene";
import { PixelSprite } from "./pixel-sprite";
import { RecordFlow, type SaveOutcome } from "./record-flow";
import { TitleView } from "./title-view";
import { PxButton, Window, clock } from "./ui";

/**
 * /log: the participant screen by default, the developer screen behind the
 * button at the top right.
 *
 * Structure, in the order a newcomer meets it:
 *   1. the title screen: what this is and one button (or, where no ping can
 *      reach, how to move to where it can);
 *   2. consent, as a window over the dimmed page;
 *   3. the setup quest: notifications, location, one practice record with
 *      hints at each step;
 *   4. the waiting screen: when the next ping comes, today's records;
 *   5. the record flow, full screen, opened by a ping or by hand.
 */

const PING_INTERVAL_MINUTES = 10;
const PENDING_KEY = "trace-ping-pending";
const VIEW_KEY = "trace-log-view";
const GEO_OK_KEY = "trace-geo-ok";
const SKIP_NOTIFY_KEY = "trace-setup-skip-notify";
const SKIP_PRACTICE_KEY = "trace-setup-skip-practice";
const PROMPT_MESSAGE = "trace-ping";

type View = "participant" | "developer";
type Flow = { kind: "ping" | "manual"; promptedAt: string | null; tutorial: boolean };

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

/** The ping waiting for an answer: from the notification that opened the page, or one left over from before. */
function initialPending(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("prompt");
  if (fromUrl && !Number.isNaN(Date.parse(fromUrl))) {
    write(window.localStorage, PENDING_KEY, fromUrl);
    return fromUrl;
  }
  return read(window.localStorage, PENDING_KEY);
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
  // Opened from the title screen's button, once the person has seen what this is.
  const [consentOpen, setConsentOpen] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [support] = useState<PushSupport>(pushSupport);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(subscriptionExpiresAt);
  const [pendingAt, setPendingAt] = useState<string | null>(initialPending);
  // A tapped notification opens straight into the record flow.
  const [flow, setFlow] = useState<Flow | null>(() => {
    const pending = initialPending();
    return pending && loadConsent() ? { kind: "ping", promptedAt: pending, tutorial: false } : null;
  });
  const [now, setNow] = useState(() => Date.now());
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [permission, setPermission] = useState(notificationState);
  const [geolocation, setGeolocation] = useState<PermissionState | "unknown" | null>(null);
  const [geoOk, setGeoOk] = useState(() => read(window.localStorage, GEO_OK_KEY) === "1");
  const [skipNotify, setSkipNotify] = useState(() => read(window.localStorage, SKIP_NOTIFY_KEY) === "1");
  const [skipPractice, setSkipPractice] = useState(() => read(window.localStorage, SKIP_PRACTICE_KEY) === "1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const prompt = useCallback((value: string | null) => {
    write(window.localStorage, PENDING_KEY, value);
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
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
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
      if (event.data?.type !== PROMPT_MESSAGE) return;
      prompt(event.data.promptedAt);
      setFlow((current) => current ?? { kind: "ping", promptedAt: event.data.promptedAt, tutorial: false });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [prompt, sendUnsent]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const subscribed = subscription !== null && (!expiresAt || Date.parse(expiresAt) > now);
  const setup: SetupStatus = {
    consent: consent !== null,
    notify: subscribed ? "done" : skipNotify ? "skipped" : permission === "denied" ? "denied" : "todo",
    location: geolocation === "denied" ? "denied" : geolocation === "granted" || geoOk ? "done" : "todo",
    practice: entries.length > 0 ? "done" : skipPractice ? "skipped" : "todo",
  };

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
    setConsentOpen(false);
    setMessage("");
  };

  const enableNotifications = () => run(async () => {
    if (!consent) return;
    if (notificationState() === "unsupported") throw new Error("このブラウザでは通知を受け取れません。");
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") return;
    const registration = registrationRef.current ?? (await navigator.serviceWorker.ready);
    setSubscription(await subscribe(registration, consent.version));
    setExpiresAt(subscriptionExpiresAt());
    setMessage(`通知をオンにしました。${PING_INTERVAL_MINUTES}分ごとに届きます。`);
  });

  const skipNotifications = () => {
    write(window.localStorage, SKIP_NOTIFY_KEY, "1");
    setSkipNotify(true);
  };

  const startWithoutNotifications = () => {
    skipNotifications();
    setConsentOpen(true);
  };

  const requestLocation = () => {
    if (!("geolocation" in navigator)) {
      setMessage("この端末では位置情報を使えません。");
      return;
    }
    setBusy(true);
    setMessage("");
    const allowed = () => {
      write(window.localStorage, GEO_OK_KEY, "1");
      setGeoOk(true);
      setBusy(false);
    };
    navigator.geolocation.getCurrentPosition(
      () => {
        setGeolocation("granted");
        allowed();
      },
      (error) => {
        // Only a refusal matters here; a slow or failed first fix still means permission was given.
        if (error.code === error.PERMISSION_DENIED) {
          setGeolocation("denied");
          setBusy(false);
        } else allowed();
      },
      { enableHighAccuracy: false, maximumAge: 60000, timeout: 20000 },
    );
  };

  const skipPracticeRun = () => {
    write(window.localStorage, SKIP_PRACTICE_KEY, "1");
    setSkipPractice(true);
  };

  const stop = () => run(async () => {
    if (!subscription) return;
    await unsubscribe(subscription);
    setSubscription(null);
    setExpiresAt(null);
    setMessage("通知を止めました。");
  });

  const test = () => run(async () => {
    if (!subscription) return;
    await sendTestPing(subscription);
    setMessage("テスト通知を送りました。数秒で届きます。");
  });

  const save = async (entry: LogEntry): Promise<SaveOutcome> => {
    await putEntry(entry);
    if (entry.record.kind === "ping") prompt(null);
    const failed = await sendUnsent();
    return !PUSH_API_URL ? "local" : failed ? "queued" : "sent";
  };

  const closeFlow = () => {
    if (flow?.kind === "ping") prompt(null);
    setFlow(null);
  };

  const withdraw = () => run(async () => {
    if (!window.confirm("通知を止め、この端末から送ったデータをすべて削除します。よろしいですか？")) return;
    if (subscription) await unsubscribe(subscription).catch(() => subscription.unsubscribe());
    const deleted = PUSH_API_URL ? await forgetMe() : 0;
    await clearEntries();
    clearConsent();
    prompt(null);
    for (const key of [SKIP_NOTIFY_KEY, SKIP_PRACTICE_KEY]) write(window.localStorage, key, null);
    setSkipNotify(false);
    setSkipPractice(false);
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

  const clearLocal = () => run(async () => {
    if (!window.confirm("この端末に残っている記録を削除します。送信済みのデータはサーバーに残ります。よろしいですか？")) return;
    await clearEntries();
    setEntries([]);
  });

  const today = entries.filter((entry) => isToday(entry.record.takenAt));
  const unsent = entries.filter((entry) => !entry.sentAt).length;

  return (
    <>
      <PixelScene phase={phaseAt(now)} />
      <main className="relative z-[1] mx-auto w-full max-w-md space-y-7 px-4 pt-[max(10px,env(safe-area-inset-top))] pb-[calc(56px+env(safe-area-inset-bottom))]">
        <header className="px-on-scene flex min-h-11 items-center justify-between gap-3">
          {consent || view === "developer" ? (
            <p className="flex items-center gap-2" aria-label="TRACE">
              <PixelSprite name="pin" scale={2} />
              <span className="px-pixel px-outlined text-[14px]" aria-hidden="true">TRACE</span>
            </p>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="min-h-11 bg-(--px-navy) px-3 text-[13px] text-(--px-ink-2) shadow-[0_0_0_2px_var(--px-k)] focus-visible:outline-3 focus-visible:outline-(--px-focus)"
            onClick={() => switchView(view === "developer" ? "participant" : "developer")}
          >
            {view === "developer" ? "参加者向けにもどる" : "開発者向け"}
          </button>
        </header>

        {(busy || message) && <p className="px-note px-note--float" role="status">{busy ? "処理しています…" : message}</p>}

        {pendingAt && !flow && consent && view === "participant" && (
          <Window tone="alert" title={<><span className="px-blink">!</span> 記録の時間です</>} as="section">
            <p className="text-[16px]">{clock(pendingAt)} の通知です。いまいる場所を記録してください。</p>
            <div className="mt-3 flex gap-1">
              <PxButton variant="secondary" onClick={() => prompt(null)}>スキップ</PxButton>
              <PxButton block icon="pin" onClick={() => setFlow({ kind: "ping", promptedAt: pendingAt, tutorial: false })}>記録する</PxButton>
            </div>
          </Window>
        )}

        {view === "developer" ? (
          <>
            {!PUSH_API_URL && (
              <p className="px-note px-note--float" data-tone="warn">通知サーバーの URL が設定されていません。NEXT_PUBLIC_PUSH_API_URL を設定してください。</p>
            )}
            <DeveloperView
              apiUrl={PUSH_API_URL}
              deviceId={deviceId()}
              consent={consent}
              notificationPermission={permission}
              geolocationPermission={geolocation}
              pushSupport={support}
              subscription={subscribed ? subscription : null}
              expiresAt={expiresAt}
              nextPingAt={nextPingAt(now)}
              entries={entries}
              busy={busy}
              onTest={() => void test()}
              onRecordNow={() => setFlow({ kind: "manual", promptedAt: null, tutorial: false })}
              onResend={() => void resend()}
              onClearLocal={() => void clearLocal()}
              onResetSetup={() => {
                setShowSetup(true);
                switchView("participant");
              }}
            />
          </>
        ) : !consent ? (
          <TitleView support={support} onStart={() => setConsentOpen(true)} onStartWithoutNotifications={startWithoutNotifications} />
        ) : (
          <HomeView
            setup={setup}
            forceSetup={showSetup}
            support={support}
            subscribed={subscribed}
            pending={pendingAt !== null}
            nextPingAt={nextPingAt(now)}
            now={now}
            todayCount={today.length}
            todayUnsent={today.filter((entry) => !entry.sentAt).length}
            unsent={unsent}
            busy={busy}
            geolocationDenied={geolocation === "denied"}
            onOpenConsent={() => setConsentOpen(true)}
            onEnableNotifications={() => void enableNotifications()}
            onSkipNotifications={skipNotifications}
            onRequestLocation={requestLocation}
            onStartPractice={() => setFlow({ kind: "manual", promptedAt: null, tutorial: true })}
            onSkipPractice={skipPracticeRun}
            onCloseSetup={() => setShowSetup(false)}
            onRecordNow={() => setFlow({ kind: "manual", promptedAt: null, tutorial: false })}
            onStopNotifications={() => void stop()}
            onResend={() => void resend()}
            onShowHowTo={() => setHowToOpen(true)}
            onWithdraw={() => void withdraw()}
          />
        )}
      </main>

      {flow && consent && (
        <RecordFlow
          key={`${flow.kind}-${flow.promptedAt}-${flow.tutorial}`}
          kind={flow.kind}
          promptedAt={flow.promptedAt}
          tutorial={flow.tutorial}
          consent={consent}
          developer={view === "developer"}
          subscribed={subscribed}
          nextPingAt={nextPingAt(now)}
          todayCount={today.length}
          onSave={save}
          onClose={closeFlow}
        />
      )}

      <ConsentDialog open={consentOpen && !flow} onAgree={consent ? undefined : agree} onClose={() => setConsentOpen(false)} />
      <HowToDialog open={howToOpen} onClose={() => setHowToOpen(false)} />
    </>
  );
}
