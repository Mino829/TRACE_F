"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Shot } from "@/lib/ping-log/photo-entry";
import { CONSENT_VERSION, clearConsent, loadConsent, saveConsent, type Consent } from "@/lib/ping-log/consent";
import { networkInfo } from "@/lib/ping-log/context";
import { pushSupport, type PushSupport } from "@/lib/ping-log/environment";
import {
  PUSH_API_URL,
  REMINDER_PLAN,
  deviceId,
  dropExpired,
  forgetMe,
  sendTestPing,
  isUploadablePhoto,
  subscribe,
  subscriptionExpiresAt,
  subscriptionPlan,
  unsubscribe,
  uploadEntry,
  type PushPlan,
} from "@/lib/ping-log/push";
import { MAX_PHOTOS, purposeOf } from "@/lib/ping-log/record";
import { dropPromptFromUrl } from "@/lib/ping-log/url";
import { clearEntries, listEntries, putEntry, type LogEntry, type SaveOutcome } from "@/lib/ping-log/store";
import {
  TRACE_API_URL,
  TraceApiError,
  createExperience,
  deleteMemorySession,
  fetchPublicConfig,
  getExperience,
  type PublicConfig,
} from "@/lib/trace-api/client";
import {
  clearTabExperience,
  loadTabExperience,
  memoryDeleteKey,
  saveTabExperience,
  updateTabExperience,
  type TabExperience,
} from "@/lib/trace-api/session";

import { DeveloperView } from "./developer-view";
import { RayApp } from "./ray/app";
import { PxButton, Sentences } from "./ui";

import "./developer.css";

/**
 * /log has two faces.
 *
 * The participant screen (the default) shows the team what the finished
 * photo memory would be like, following the work's documents, in ShibaLab's
 * RAY look (ray/app.tsx):
 *   1. the title screen: what the work is and one button;
 *   2. consent, full screen;
 *   3. home: today's photos shown large, the camera button, and the optional reminder's switch;
 *   4. the photo flow, full screen: a look at the photo, then the clear screen.
 * A reminder that opens the page has a screen of its own; one left unanswered
 * shows on home. Both offer "写真を撮る" and "スキップ", and both end on the
 * clear screen.
 *
 * With NEXT_PUBLIC_TRACE_API_URL set, agreeing also creates the experience on
 * the work's backend (TRACE_B), and joining lasts as long as this tab keeps
 * its credential: the photo limit comes from the backend's config and counts
 * per memory session, and "参加をやめる" deletes the memory session too. Photos, the arrival QR, the
 * story and the reminder have no backend routes yet and stay on the phone and
 * the push worker, as everything does when the variable is unset.
 *
 * The developer screen keeps legacy records and their deletion controls
 * accessible; it no longer offers location capture or accuracy pings.
 */

const PENDING_KEY = "trace-ping-pending";
const VIEW_KEY = "trace-log-view";
const PROMPT_MESSAGE = "trace-ping";

type View = "participant" | "developer";

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

function isToday(value: string): boolean {
  return new Date(value).toDateString() === new Date().toDateString();
}

/** The notification waiting for an answer: from the one that opened the page, or one left from earlier today. */
function initialPending(): string | null {
  if (subscriptionPlan().purpose !== "photo") {
    write(window.localStorage, PENDING_KEY, null);
    return null;
  }
  const fromUrl = new URLSearchParams(window.location.search).get("prompt");
  if (fromUrl && !Number.isNaN(Date.parse(fromUrl))) {
    write(window.localStorage, PENDING_KEY, fromUrl);
    return fromUrl;
  }
  const stored = read(window.localStorage, PENDING_KEY);
  return stored && isToday(stored) ? stored : null;
}

/** Consent from an earlier tab, but no credential in this one: the backend's experience cannot be picked up again. */
function initialMessage(): string {
  return TRACE_API_URL && loadConsent() && !loadTabExperience() ? "前の参加は、このタブでは続けられません。もう一度「はじめる」から参加してください。" : "";
}

function initialView(): View {
  return read(window.localStorage, VIEW_KEY) === "developer" ? "developer" : "participant";
}

/** A participant who opened the page from a reminder's notification sees the reminder's own screen first. */
function initialPingOpen(): boolean {
  const fromUrl = new URLSearchParams(window.location.search).get("prompt");
  return initialView() === "participant" && subscriptionPlan().purpose === "photo" && !!fromUrl && !Number.isNaN(Date.parse(fromUrl));
}

function notificationState(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" || !("PushManager" in window) ? "unsupported" : Notification.permission;
}

/** The worker pings on whole multiples of the interval, counted in minutes since the epoch. */
function nextMark(now: number, intervalMinutes: number): number {
  const step = intervalMinutes * 60 * 1000;
  return Math.floor(now / step) * step + step;
}

export function PingLogScreen() {
  // The developer screen stays until it is switched back, through reloads and notification launches.
  const [view, setView] = useState<View>(initialView);
  const [consent, setConsent] = useState<Consent | null>(loadConsent);
  // Opened from the title screen's button, once the person has seen what this is.
  const [consentOpen, setConsentOpen] = useState(false);
  const [support] = useState<PushSupport>(pushSupport);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(subscriptionExpiresAt);
  const [plan, setPlan] = useState<PushPlan>(subscriptionPlan);
  const [pendingAt, setPendingAt] = useState<string | null>(initialPending);
  const [pingOpen, setPingOpen] = useState(initialPingOpen);
  const [shot, setShot] = useState<Shot | null>(null);
  // When the skipped reminder was due, while the skip's clear screen is up.
  const [skipped, setSkipped] = useState<string | null>(null);
  // The arrival demo, and where it was opened from.
  const [demo, setDemo] = useState<"home" | "developer" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [permission, setPermission] = useState(notificationState);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  // The backend's side, while NEXT_PUBLIC_TRACE_API_URL is set.
  const [traceConfig, setTraceConfig] = useState<PublicConfig | null>(null);
  const [experience, setExperience] = useState<TabExperience | null>(() => (TRACE_API_URL ? loadTabExperience() : null));
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // The reminder the camera was opened for, read when the photo comes back.
  const cameraPromptRef = useRef<string | null>(null);
  const viewRef = useRef(view);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const prompt = useCallback((value: string | null) => {
    write(window.localStorage, PENDING_KEY, value);
    setPendingAt(value);
  }, []);

  /** Send only GPS-free checkpoint photos; leave legacy and unsafe records untouched locally. */
  const sendUnsent = useCallback(async (): Promise<number> => {
    const items = await listEntries();
    if (!PUSH_API_URL) {
      setEntries(items);
      return 0;
    }
    let failed = 0;
    for (const entry of items) {
      if (entry.sentAt || !isUploadablePhoto(entry)) continue;
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
    dropPromptFromUrl();
    listEntries()
      .then((items) => {
        setEntries(items);
        return sendUnsent();
      })
      .catch(() => setMessage("記録を読み込めませんでした。"));
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/ping-sw.js", { scope: "/" })
      .then(async (registration) => {
        registrationRef.current = registration;
        if (!("pushManager" in registration)) return;
        const current = await registration.pushManager.getSubscription();
        const expiry = subscriptionExpiresAt();
        // Previous releases used one subscription for accuracy pings. Remove
        // that subscription without touching a photo reminder on this phone.
        if (current && subscriptionPlan().purpose === "accuracy") {
          try {
            await unsubscribe(current);
          } catch {
            await dropExpired(current);
            setMessage("以前の精度テスト通知を端末で停止しました。サーバーへの解除は確認できませんでした。");
          }
          setExpiresAt(null);
          setSubscription(null);
        } else if (current && expiry && Date.parse(expiry) <= Date.now()) {
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
      if (subscriptionPlan().purpose !== "photo") return;
      prompt(event.data.promptedAt);
      if (viewRef.current === "participant") setPingOpen(true);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [prompt, sendUnsent]);

  // The backend's config and, after a reload, whether this tab's experience still stands.
  useEffect(() => {
    if (!TRACE_API_URL) return;
    // Fetched again on agreeing when this fails.
    fetchPublicConfig().then(setTraceConfig, () => undefined);
    const stored = loadTabExperience();
    if (!stored) return;
    getExperience(stored.experienceId, stored.memory)
      .then((status) => setExperience(updateTabExperience(stored, status)))
      .catch((error: unknown) => {
        // A read failure does not prove deletion; keep the credential and its delete key.
        setMessage(error instanceof Error ? error.message : "参加状態を取得できませんでした。");
      });
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const subscribed = subscription !== null && (!expiresAt || Date.parse(expiresAt) > now);
  const activePlan = subscribed ? plan : null;
  const upcoming = activePlan ? nextMark(now, activePlan.intervalMinutes) : null;
  // The subscription ends at midnight: after the day's last ping there is no next one.
  const nextPingAt = upcoming !== null && (!expiresAt || upcoming < Date.parse(expiresAt)) ? upcoming : null;
  const nextReminderAt = activePlan?.purpose === "photo" ? nextPingAt : null;

  // With the backend, joining lasts as long as this tab's memory session.
  const sessionExpired = experience !== null && Date.parse(experience.memory.expiresAt) <= now;
  const joined = consent?.version === CONSENT_VERSION && (!TRACE_API_URL || (experience !== null && !sessionExpired));
  const memorySessionId = joined ? (experience?.memory.memorySessionId ?? null) : null;
  const maxPhotos = (TRACE_API_URL && traceConfig?.photo.maxCount) || MAX_PHOTOS;

  // This participation's photos: the memory session's with the backend, the day's without.
  // Kept stable through the clock's ticks, so the photos' object URLs are not remade every second.
  const day = new Date(now).toDateString();
  const memoryPhotos = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            purposeOf(entry.record) === "photo-memory" &&
            (TRACE_API_URL ? memorySessionId !== null && entry.memorySessionId === memorySessionId : new Date(entry.record.takenAt).toDateString() === day),
        )
        .reverse(),
    [entries, day, memorySessionId],
  );

  /**
   * Runs a task behind the busy note; resolves to its error message, or null
   * when it worked. A silent task leaves the error to its caller, to show next
   * to the button that was pressed.
   */
  const run = async (task: () => Promise<void>, { silent = false } = {}): Promise<string | null> => {
    setBusy(true);
    setMessage("");
    try {
      await task();
      return null;
    } catch (error) {
      const text = error instanceof Error ? error.message : "うまくいきませんでした。";
      if (!silent) setMessage(text);
      return text;
    } finally {
      setBusy(false);
    }
  };

  const switchView = (next: View) => {
    write(window.localStorage, VIEW_KEY, next === "developer" ? next : null);
    setView(next);
    setMessage("");
  };

  /** Keep an existing memory session and its delete key when consent text changes. */
  const agree = async () => {
    if (TRACE_API_URL) {
      setJoining(true);
      setJoinError("");
      try {
        if (experience) {
          if (Date.parse(experience.memory.expiresAt) <= Date.now()) {
            throw new Error("以前の参加の期限が切れました。メニューの「参加をやめる」から以前の記録を削除してから、もう一度参加してください。");
          }
        } else {
          const config = traceConfig ?? (await fetchPublicConfig());
          setTraceConfig(config);
          if (!config.registrationOpen) throw new TraceApiError(503, "REGISTRATION_CLOSED", null);
          const created = await createExperience(config);
          const tab: TabExperience = { ...created, consentVersion: config.consent.version, createdAt: new Date().toISOString() };
          saveTabExperience(tab);
          setExperience(tab);
        }
      } catch (error) {
        if (error instanceof TraceApiError && error.code === "CONSENT_VERSION_MISMATCH") fetchPublicConfig().then(setTraceConfig, () => setTraceConfig(null));
        setJoinError(error instanceof Error ? error.message : "うまくいきませんでした。");
        return;
      } finally {
        setJoining(false);
      }
    }
    setConsent(saveConsent());
    setConsentOpen(false);
    setMessage("");
  };

  /** The participant's optional photo reminder is the only new push plan. */
  const subscribeTo = (consentVersion: string, done: string, silent = false) => run(async () => {
    if (notificationState() === "unsupported") throw new Error("このブラウザでは通知を受け取れません。");
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") throw new Error("通知が許可されていません。スマホやブラウザの設定で、このサイトの通知を許可してください。");
    const registration = registrationRef.current ?? (await navigator.serviceWorker.ready);
    setSubscription(await subscribe(registration, consentVersion));
    setExpiresAt(subscriptionExpiresAt());
    setPlan(REMINDER_PLAN);
    setMessage(done);
  }, { silent });

  // The switch shows the result itself; an error goes beside it, not up in the note.
  const switchReminder = (on: boolean): Promise<string | null> => {
    if (!on) {
      return run(async () => {
        if (!subscription) return;
        await unsubscribe(subscription);
        setSubscription(null);
        setExpiresAt(null);
      }, { silent: true });
    }
    return joined && consent ? subscribeTo(consent.version, "", true) : Promise.resolve("参加の同意がまだです。");
  };


  const stopNotifications = (done: string) => void run(async () => {
    if (!subscription) return;
    try {
      await unsubscribe(subscription);
      setMessage(done);
    } catch {
      if (plan?.purpose !== "accuracy") throw new Error("通知を停止できませんでした。");
      await dropExpired(subscription);
      setMessage("旧・精度テスト通知を端末で停止しました。サーバーへの解除は確認できませんでした。");
    }
    setSubscription(null);
    setExpiresAt(null);
  });

  const test = () => void run(async () => {
    if (!subscription) return;
    await sendTestPing(subscription);
    setMessage("テスト通知を送りました。数秒で届きます。");
  });

  /** Opens the phone's camera. It has to happen inside the tap, or the browser refuses. */
  const openCamera = (promptedAt: string | null) => {
    cameraPromptRef.current = promptedAt;
    cameraRef.current?.click();
  };

  const onCameraFile = (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = "";
    if (!file || !joined || memoryPhotos.length >= maxPhotos) return;
    // The photo's moment is when the camera hands it over. Where it was taken is chosen afterwards, on the place screen.
    setShot({
      id: crypto.randomUUID(),
      file,
      receivedAt: Date.now(),
      promptedAt: cameraPromptRef.current,
      network: networkInfo(),
      number: memoryPhotos.length + 1,
    });
  };

  const skipReminder = () => {
    setSkipped(pendingAt ?? new Date().toISOString());
    prompt(null);
    setPingOpen(false);
  };

  const save = async (entry: LogEntry): Promise<SaveOutcome> => {
    await putEntry(memorySessionId && purposeOf(entry.record) === "photo-memory" ? { ...entry, memorySessionId } : entry);
    if (entry.record.kind === "ping") prompt(null);
    const failed = await sendUnsent();
    return !PUSH_API_URL ? "local" : failed ? "queued" : "sent";
  };


  const withdraw = () => run(async () => {
    // The backend's memory session goes first: if it cannot be deleted, nothing else is, and the person can try again.
    let backendNote = "";
    if (TRACE_API_URL && experience) {
      try {
        await deleteMemorySession(experience.memory, memoryDeleteKey(experience.memory.memorySessionId));
        backendNote = "参加の記録も削除しました。";
      } catch (error) {
        throw new Error(`参加をやめられませんでした。${error instanceof Error ? error.message : ""}`);
      }
      clearTabExperience();
      setExperience(null);
    }
    if (subscription) await unsubscribe(subscription).catch(() => subscription.unsubscribe());
    const deleted = PUSH_API_URL ? await forgetMe() : 0;
    await clearEntries();
    clearConsent();
    prompt(null);
    setSubscription(null);
    setExpiresAt(null);
    setEntries([]);
    setConsent(null);
    setMessage(`参加をやめました。送られたデータ ${deleted}件を削除しました。${backendNote}`);
  });

  const resend = () => void run(async () => {
    const failed = await sendUnsent();
    setMessage(failed ? `${failed}件を送信できませんでした。位置情報を含む旧記録は送信せず、端末に残します。` : "送信可能な写真を送りました。旧記録は端末に残します。");
  });

  const clearLocal = () => void run(async () => {
    if (!window.confirm("この端末に残っている記録を削除します。送信済みのデータはサーバーに残ります。よろしいですか？")) return;
    await clearEntries();
    setEntries([]);
  });

  // The camera, opened from a tap on "写真を撮る" or "撮り直す".
  const camera = <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(event) => onCameraFile(event.currentTarget)} />;

  // The arrival demo is the participant's, in their look, wherever it was opened from.
  if (view === "participant" || demo !== null) {
    const notes = [
      ...(!joined && consent && sessionExpired ? ["参加の期限が切れました。以前の記録を削除する場合はメニューの「参加をやめる」を選んでください。"] : []),
      ...(message ? [message] : []),
    ];
    return (
      <>
        <RayApp
          joined={joined}
          consent={consent}
          consentOpen={consentOpen}
          onOpenConsent={() => setConsentOpen(true)}
          onCloseConsent={() => {
            setConsentOpen(false);
            setJoinError("");
          }}
          onAgree={agree}
          joining={joining}
          joinError={joinError}
          notes={notes}
          busy={busy}
          support={support}
          photos={memoryPhotos}
          maxPhotos={maxPhotos}
          pendingAt={pendingAt}
          pingOpen={pingOpen}
          onClosePing={() => setPingOpen(false)}
          reminderOn={activePlan?.purpose === "photo"}
          nextReminderAt={nextReminderAt}
          onReminder={switchReminder}
          shot={shot}
          onRetake={() => openCamera(shot?.promptedAt ?? null)}
          onSave={save}
          onCloseShot={() => {
            setShot(null);
            setPingOpen(false);
          }}
          skipped={skipped}
          onCloseSkip={() => setSkipped(null)}
          demo={demo}
          // The booth's QR code and the replay wait for the work's backend; until then the button opens the demo.
          onArrive={() => setDemo("home")}
          onCloseDemo={() => setDemo(null)}
          onTakePhoto={() => openCamera(pendingAt)}
          onSkip={skipReminder}
          onResend={resend}
          onWithdraw={async () => {
            await withdraw();
          }}
          onDeveloper={() => switchView("developer")}
          onHome={() => {
            if (view !== "participant") switchView("participant");
          }}
        />
        {camera}
      </>
    );
  }

  return (
    <div className="px-root px-ray">
      <main className="relative z-[1] mx-auto w-full max-w-md space-y-7 px-4 pt-[max(10px,env(safe-area-inset-top))] pb-[calc(56px+env(safe-area-inset-bottom))]">
        <header className="flex min-h-11 items-center justify-between gap-3">
          <p className="flex items-baseline gap-2">
            <button type="button" className="px-ray-mark" aria-label="TRACE（参加者のホーム）" onClick={() => switchView("participant")}>
              TRACE
            </button>
            <span className="px-label">Developer</span>
          </p>
          <PxButton variant="secondary" size="sm" onClick={() => switchView("participant")}>
            参加者向けにもどる
          </PxButton>
        </header>

        {(busy || message) && (
          <p className="px-note px-note--float" role="status">
            <Sentences text={busy ? "処理しています…" : message} />
          </p>
        )}

        {!PUSH_API_URL && (
          <p className="px-note px-note--float" data-tone="warn">通知サーバーの URL が設定されていません。NEXT_PUBLIC_PUSH_API_URL を設定してください。</p>
        )}
        <DeveloperView
          apiUrl={PUSH_API_URL}
          deviceId={deviceId()}
          consent={consent}
          notificationPermission={permission}
          pushSupport={support}
          subscription={subscribed ? subscription : null}
          plan={activePlan}
          expiresAt={expiresAt}
          nextPingAt={nextPingAt}
          entries={entries}
          busy={busy}
          onStopNotifications={() => stopNotifications("通知を止めました。")}
          onTest={test}
          onResend={resend}
          onClearLocal={clearLocal}
          onOpenDemo={() => setDemo("developer")}
        />
      </main>

    </div>
  );
}
