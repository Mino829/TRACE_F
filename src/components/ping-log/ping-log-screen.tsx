"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Shot } from "@/lib/ping-log/photo-entry";
import { DEVELOPER_CONSENT_VERSION, clearConsent, loadConsent, saveConsent, type Consent } from "@/lib/ping-log/consent";
import { networkInfo } from "@/lib/ping-log/context";
import { pushSupport, type PushSupport } from "@/lib/ping-log/environment";
import {
  ACCURACY_PLAN,
  PUSH_API_URL,
  REMINDER_PLAN,
  deviceId,
  dropExpired,
  forgetMe,
  sendTestPing,
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
import { LockTimeout, onOtherTabs, withLock } from "@/lib/ping-log/tabs";
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
  experienceLapsed,
  forgetLapsedExperience,
  loadTabExperience,
  memoryDeleteKey,
  saveTabExperience,
  updateTabExperience,
  type TabExperience,
} from "@/lib/trace-api/session";

import { DeveloperView } from "./developer-view";
import { RayApp } from "./ray/app";
import { WORKER_REMINDER } from "./ray/screens";
import { RecordFlow } from "./record-flow";
import { useTraceReminder } from "./use-trace-reminder";
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
 * the work's backend (TRACE_B), and joining lasts until its memory session
 * expires, through reloads and in every tab of the browser (session.ts,
 * tabs.ts): the photo limit comes from the backend's config and counts per
 * memory session, and "参加をやめる" deletes the memory session too. The
 * arrival QR is read with the camera and sent to the backend (ray/arrival.tsx),
 * and the photo reminder goes through TRACE_B as well (trace-api/reminder.ts).
 * Photos and the story have no backend routes yet and stay on the phone and
 * the push worker, as everything does when the variable is unset.
 *
 * The developer screen, behind the button left of the menu, is the team's
 * accuracy test: the ten-minute ping answered by pointing at where one
 * stands, the phone's records, and the demo of arriving at the venue. Its
 * pixel parts wear RAY's paper and ink (developer.css). Visitors never use it.
 */

const PENDING_KEY = "trace-ping-pending";
const VIEW_KEY = "trace-log-view";
const PROMPT_MESSAGE = "trace-ping";
const SEND_LOCK = "trace-log-send";
/** How long a save waits for another tab that is sending; after that its photo waits for the next try. */
const SEND_WAIT_MS = 10_000;
const START_AGAIN = "続けるときは、もう一度「はじめる」から参加してください。";

type View = "participant" | "developer";
type AccuracyFlow = { kind: "ping" | "manual"; promptedAt: string | null };

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
  const fromUrl = new URLSearchParams(window.location.search).get("prompt");
  if (fromUrl && !Number.isNaN(Date.parse(fromUrl))) {
    write(window.localStorage, PENDING_KEY, fromUrl);
    return fromUrl;
  }
  const stored = read(window.localStorage, PENDING_KEY);
  return stored && isToday(stored) ? stored : null;
}

/**
 * Why there is no participation to continue although there was one: the
 * backend deleted it at the end of its period, or this browser never had it
 * although it agreed or a reminder opened it (another browser, or the other
 * side of Safari and the home-screen app, started it; the wording is
 * user-journey.md's, with this page's button).
 */
function initialLostNote(): string {
  if (!TRACE_API_URL || initialView() !== "participant") return "";
  if (experienceLapsed()) return `前の参加は、記録を残す期限が過ぎたので削除されました。${START_AGAIN}`;
  const fromReminder = new URLSearchParams(window.location.search).has("prompt");
  return (loadConsent() || fromReminder) && !loadTabExperience()
    ? "この画面には、前の参加の記録がありません。参加を始めたブラウザか、ホーム画面のアプリで開いてください。開けないときは、もう一度「はじめる」から参加できます。"
    : "";
}

function initialView(): View {
  return read(window.localStorage, VIEW_KEY) === "developer" ? "developer" : "participant";
}

/** A participant who opened the page from a reminder's notification sees the reminder's own screen first. */
function initialPingOpen(): boolean {
  const fromUrl = new URLSearchParams(window.location.search).get("prompt");
  return initialView() === "participant" && !!fromUrl && !Number.isNaN(Date.parse(fromUrl));
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
  // On the developer screen a tapped notification opens the accuracy record straight away.
  const [accuracyFlow, setAccuracyFlow] = useState<AccuracyFlow | null>(() => {
    const pending = initialPending();
    return pending && initialView() === "developer" ? { kind: "ping", promptedAt: pending } : null;
  });
  const [shot, setShot] = useState<Shot | null>(null);
  // When the skipped reminder was due, while the skip's clear screen is up.
  const [skipped, setSkipped] = useState<string | null>(null);
  // The arrival demo, and where it was opened from.
  const [demo, setDemo] = useState<"home" | "developer" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [permission, setPermission] = useState(notificationState);
  const [geolocation, setGeolocation] = useState<PermissionState | "unknown" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // Shown until this browser joins again, in this tab or another.
  const [lostNote, setLostNote] = useState(initialLostNote);
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
  // While this tab holds a TRACE_B memory credential, the photo reminder is TRACE_B's (#17).
  const trace = useTraceReminder({ experience, config: traceConfig, setConfig: setTraceConfig, subscription, setSubscription,
    setWorkerExpiresAt: setExpiresAt, registration: registrationRef, now });
  const { noteArrival } = trace;

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const prompt = useCallback((value: string | null) => {
    write(window.localStorage, PENDING_KEY, value);
    setPendingAt(value);
  }, []);

  /**
   * Sends every record the worker has not acknowledged yet; the rest wait for
   * the next try. One tab sends at a time and reads the records afresh before
   * each, so one that another tab sent meanwhile is not sent again, and one
   * saved meanwhile goes in the same round.
   */
  const sendUnsent = useCallback(async (): Promise<number> => {
    // Without a worker there is nothing to send, but a record just saved still has to show.
    if (!PUSH_API_URL) {
      setEntries(await listEntries());
      return 0;
    }
    const failed = await withLock(
      SEND_LOCK,
      async () => {
        let failures = 0;
        const tried = new Set<string>();
        for (;;) {
          const entry = (await listEntries()).find((item) => !item.sentAt && !tried.has(item.id));
          if (!entry) return failures;
          tried.add(entry.id);
          try {
            await uploadEntry(entry);
            await putEntry({ ...entry, sentAt: new Date().toISOString() });
          } catch {
            failures += 1;
          }
        }
      },
      { waitMs: SEND_WAIT_MS },
    ).catch(async (error: unknown) => {
      // Another tab is still sending; it takes the new records too, or the next try does.
      if (!(error instanceof LockTimeout)) throw error;
      return (await listEntries()).filter((item) => !item.sentAt).length;
    });
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
      if (viewRef.current === "developer") setAccuracyFlow((current) => current ?? { kind: "ping", promptedAt: event.data.promptedAt });
      else setPingOpen(true);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [prompt, sendUnsent]);

  // The backend's config and, after a reload, whether this tab's experience still stands.
  useEffect(() => {
    if (!TRACE_API_URL) return;
    // Fetched again on agreeing when this fails.
    fetchPublicConfig().then(setTraceConfig, () => undefined);
    // A participation that is gone takes its consent along: the next visit starts as a new one, without a note.
    const forget = () => {
      clearTabExperience();
      clearConsent();
      setExperience(null);
      setConsent(null);
    };
    if (forgetLapsedExperience()) forget();
    const stored = loadTabExperience();
    if (!stored) return;
    getExperience(stored.experienceId, stored.memory)
      .then((status) => {
        setExperience(updateTabExperience(stored, status));
        if (status.replayStatus) noteArrival(stored.memory.memorySessionId);
      })
      .catch((error: unknown) => {
        // The backend itself says it no longer knows the credential (deleted, or past its period): forget it here too.
        if (error instanceof TraceApiError && (error.code === "UNAUTHORIZED" || error.code === "NOT_FOUND")) {
          forget();
          setLostNote(`${error.message}${START_AGAIN}`);
          return;
        }
        // Any other failure does not prove deletion; keep the credential and its delete key.
        setMessage(error instanceof Error ? error.message : "参加状態を取得できませんでした。");
      });
  }, [noteArrival]);

  // Another tab joined, withdrew, or saved or sent a photo: this one shows the same participation.
  useEffect(
    () =>
      onOtherTabs(() => {
        setConsent(loadConsent());
        if (TRACE_API_URL) {
          const next = loadTabExperience();
          setExperience(next);
          // Joined there: the note about the old participation no longer applies here.
          if (next) setLostNote("");
        }
        listEntries().then(setEntries, () => undefined);
      }),
    [],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const subscribed = subscription !== null && !trace.owned && (!expiresAt || Date.parse(expiresAt) > now);
  const activePlan = subscribed ? plan : null;
  const upcoming = activePlan ? nextMark(now, activePlan.intervalMinutes) : null;
  // The subscription ends at midnight: after the day's last ping there is no next one.
  const nextPingAt = upcoming !== null && (!expiresAt || upcoming < Date.parse(expiresAt)) ? upcoming : null;
  // Without a TRACE_B credential in the tab, the photo reminder is the push worker's, as before.
  const reminder = trace.reminder ?? { on: activePlan?.purpose === "photo", nextAt: activePlan?.purpose === "photo" ? nextPingAt : null, terms: WORKER_REMINDER };

  // With the backend, joining lasts as long as this tab's memory session.
  const sessionExpired = experience !== null && Date.parse(experience.memory.expiresAt) <= now;
  const joined = consent !== null && (!TRACE_API_URL || (experience !== null && !sessionExpired));
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
  const todayAccuracy = entries.filter((entry) => purposeOf(entry.record) === "accuracy" && isToday(entry.record.takenAt)).length;

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

  /** With the backend, the experience is created here, memory-only; joining waits until it exists. */
  const agree = async () => {
    if (TRACE_API_URL) {
      setJoining(true);
      setJoinError("");
      try {
        const config = traceConfig ?? (await fetchPublicConfig());
        setTraceConfig(config);
        if (!config.registrationOpen) throw new TraceApiError(503, "REGISTRATION_CLOSED", null);
        const created = await createExperience(config);
        const tab: TabExperience = { ...created, consentVersion: config.consent.version, createdAt: new Date().toISOString() };
        saveTabExperience(tab);
        setExperience(tab);
        // A photo reminder through the push worker belonged to the participation before; TRACE_B's takes its place once switched on.
        if (subscription && subscribed && plan.purpose === "photo") {
          void unsubscribe(subscription).catch(() => dropExpired(subscription)).then(() => setSubscription(null));
        }
      } catch (error) {
        // The text changed on the server: read the new versions before the next try.
        if (error instanceof TraceApiError && error.code === "CONSENT_VERSION_MISMATCH") fetchPublicConfig().then(setTraceConfig, () => setTraceConfig(null));
        setJoinError(error instanceof Error ? error.message : "うまくいきませんでした。");
        return;
      } finally {
        setJoining(false);
      }
    }
    setConsent(saveConsent());
    setLostNote("");
    setConsentOpen(false);
    setMessage("");
  };

  /** Asked only from a tap on a switch, once what it is for has been said. */
  const askPermission = async () => {
    if (notificationState() === "unsupported") throw new Error("このブラウザでは通知を受け取れません。");
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result !== "granted") throw new Error("通知が許可されていません。スマホやブラウザの設定で、このサイトの通知を許可してください。");
  };

  /** One subscription per phone: the photo reminder and the accuracy ping replace each other. */
  const subscribeTo = (next: PushPlan, consentVersion: string, done: string, silent = false) => run(async () => {
    await askPermission();
    const registration = registrationRef.current ?? (await navigator.serviceWorker.ready);
    setSubscription(await subscribe(registration, consentVersion, next));
    setExpiresAt(subscriptionExpiresAt());
    setPlan(next);
    setMessage(done);
  }, { silent });

  // The switch shows the result itself; an error goes beside it, not up in the note.
  const switchReminder = (on: boolean): Promise<string | null> => {
    if (trace.reminder) return run(() => trace.switchTo(on, askPermission), { silent: true });
    if (!on) {
      return run(async () => {
        if (!subscription) return;
        await unsubscribe(subscription);
        setSubscription(null);
        setExpiresAt(null);
      }, { silent: true });
    }
    return consent ? subscribeTo(REMINDER_PLAN, consent.version, "", true) : Promise.resolve("参加の同意がまだです。");
  };

  const enableAccuracyPings = () =>
    void subscribeTo(ACCURACY_PLAN, DEVELOPER_CONSENT_VERSION, `精度テストの通知をオンにしました。${ACCURACY_PLAN.intervalMinutes}分ごとに届きます。`);

  const stopNotifications = (done: string) => void run(async () => {
    if (!subscription) return;
    await unsubscribe(subscription);
    setSubscription(null);
    setExpiresAt(null);
    setMessage(done);
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

  const closeAccuracyFlow = () => {
    if (accuracyFlow?.kind === "ping") prompt(null);
    setAccuracyFlow(null);
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
    // TRACE_B's subscription went with the memory session; only the push worker's own is sent to the push worker.
    if (subscription && trace.owned) await subscription.unsubscribe().catch(() => undefined);
    else if (subscription) await unsubscribe(subscription).catch(() => subscription.unsubscribe());
    trace.forget();
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
    setMessage(failed ? `${failed}件を送信できませんでした。` : "未送信の記録を送りました。");
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
      ...(!joined && lostNote ? [lostNote] : []),
      ...(!joined && consent && sessionExpired ? [`参加の期限が切れました。${START_AGAIN}`] : []),
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
          reminderOn={reminder.on}
          nextReminderAt={reminder.nextAt}
          reminderTerms={reminder.terms}
          onReminder={switchReminder}
          onReminderInterval={(minutes) => run(() => trace.changeInterval(minutes), { silent: true })}
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
          // With the backend, home's button reads the booth's real QR code and follows the replay; without it, the button opens the demo.
          arrival={experience}
          onArrive={() => setDemo("home")}
          // TRACE_B dropped the reminder's subscription on arrival: the switch stays off from now on.
          onArrived={noteArrival}
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
          geolocationPermission={geolocation}
          pushSupport={support}
          subscription={subscribed ? subscription : null}
          plan={activePlan}
          expiresAt={expiresAt}
          nextPingAt={nextPingAt}
          entries={entries}
          busy={busy}
          onEnableAccuracy={enableAccuracyPings}
          onStopNotifications={() => stopNotifications("通知を止めました。")}
          onTest={test}
          onRecordNow={() => setAccuracyFlow({ kind: "manual", promptedAt: null })}
          onResend={resend}
          onClearLocal={clearLocal}
          onOpenDemo={() => setDemo("developer")}
        />
      </main>

      {accuracyFlow && (
        <RecordFlow
          key={`${accuracyFlow.kind}-${accuracyFlow.promptedAt}`}
          kind={accuracyFlow.kind}
          promptedAt={accuracyFlow.promptedAt}
          subscribed={activePlan?.purpose === "accuracy"}
          nextPingAt={nextPingAt}
          todayCount={todayAccuracy}
          onSave={save}
          onClose={closeAccuracyFlow}
        />
      )}
    </div>
  );
}
