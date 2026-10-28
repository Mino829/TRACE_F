/**
 * The photo reminder through TRACE_B (#17), while the tab holds a memory
 * credential. The browser's push subscription is made with TRACE_B's VAPID
 * key and registered to the memory session with PUT; changing the interval is
 * a PATCH, and switching off is a DELETE, which leaves nothing of the
 * subscription on TRACE_B. TRACE_B ends it by itself on arrival (a later PUT or
 * PATCH answers 409), on deletion and at the session's expiry; the
 * notification's text is TRACE_B's own.
 *
 * What the phone remembers about it sits in localStorage, since the browser's
 * subscription is shared by every tab: the memory session it was registered
 * to, the interval, and while TRACE_B sends to it, until when. The endpoint is
 * kept only to tell this subscription from one that replaced it; nothing here
 * is a credential.
 */

import { base64UrlToBytes, madeWith } from "@/lib/ping-log/push";

import {
  TraceApiError,
  deletePushSubscription,
  patchPushSubscription,
  putPushSubscription,
  type MemoryCredential,
  type NotificationConfig,
  type PushSubscriptionState,
} from "./client";

const KEY = "trace-b-reminder";

/** Used when the config names no interval, the same as the push worker's. */
const FALLBACK_INTERVAL = 30;

export type ActiveReminder = { endpoint: string; expiresAt: string; nextSendAt: string | null };

export type TraceReminder = {
  memorySessionId: string;
  intervalMinutes: number;
  /** TRACE_B stopped it for good when the participant arrived. */
  ended: boolean;
  /** While TRACE_B sends to this browser. */
  active: ActiveReminder | null;
};

/**
 * A refusal in the reminder's own words. ended: TRACE_B stopped it for good
 * (arrival). gone: TRACE_B no longer holds it, and switching on again works.
 */
export class ReminderError extends Error {
  constructor(
    message: string,
    readonly reason: "ended" | "gone" | "other" = "other",
  ) {
    super(message);
    this.name = "ReminderError";
  }
}

export const ENDED_MESSAGE = "ShibaLab に着いたあとは、リマインダーを使えません。";

function explain(error: unknown): Error {
  if (error instanceof TraceApiError && error.code === "STATE_CONFLICT") return new ReminderError(ENDED_MESSAGE, "ended");
  if (error instanceof TraceApiError && error.code === "NOT_FOUND") {
    return new ReminderError("リマインダーは止まっていました。続けるときは、もう一度オンにしてください。", "gone");
  }
  return error instanceof Error ? error : new ReminderError("うまくいきませんでした。");
}

export function loadTraceReminder(): TraceReminder | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(KEY) ?? "null") as TraceReminder | null;
    return stored?.memorySessionId && typeof stored.intervalMinutes === "number" ? stored : null;
  } catch {
    return null;
  }
}

export function saveTraceReminder(value: TraceReminder | null): void {
  try {
    if (value) window.localStorage.setItem(KEY, JSON.stringify(value));
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: it lasts as long as the page.
  }
}

/** On arrival TRACE_B drops the subscription and refuses another; returns the record to keep, if it changed. */
export function markTraceReminderEnded(memorySessionId: string): TraceReminder | null {
  const stored = loadTraceReminder();
  if (stored?.memorySessionId !== memorySessionId || stored.ended) return null;
  const ended = { ...stored, ended: true, active: null };
  saveTraceReminder(ended);
  return ended;
}

/** The interval a reminder starts with: the config's default, where the config allows it. */
export function startingInterval(notification: NotificationConfig | undefined): number {
  const choices = notification?.allowedIntervalsMinutes ?? [];
  const preferred = notification?.defaultIntervalMinutes ?? FALLBACK_INTERVAL;
  return choices.length === 0 || choices.includes(preferred) ? preferred : choices[0];
}

/**
 * When the next reminder should come. TRACE_B counts each interval from the
 * send before, so past the time it gave, the guess steps on by the interval.
 */
export function nextTraceReminderAt(active: ActiveReminder, intervalMinutes: number, now: number): number | null {
  if (!active.nextSendAt) return null;
  const step = intervalMinutes * 60_000;
  let at = Date.parse(active.nextSendAt);
  if (at < now) at += Math.ceil((now - at) / step) * step;
  return at < Date.parse(active.expiresAt) ? at : null;
}

function activeFrom(endpoint: string, state: PushSubscriptionState): ActiveReminder {
  return { endpoint, expiresAt: state.expiresAt, nextSendAt: state.status === "active" ? state.nextSendAt : null };
}

/**
 * Makes a fresh subscription with TRACE_B's key and registers it. The one the
 * browser held before goes first: the push worker's is handed to `retire`,
 * which tells the worker; an old one of TRACE_B's, perhaps registered to an
 * earlier participation, is only let go, so its endpoint never reaches the
 * worker and the phone is not reminded twice.
 */
export async function switchOnTraceReminder(
  registration: ServiceWorkerRegistration,
  credential: MemoryCredential,
  notification: NotificationConfig | undefined,
  intervalMinutes: number,
  retire: (subscription: PushSubscription) => Promise<void>,
): Promise<{ subscription: PushSubscription; active: ActiveReminder }> {
  const publicKey = notification?.enabled ? notification.vapidPublicKey : "";
  if (!publicKey) throw new ReminderError("いまはリマインダーを使えません。");
  const existing = await registration.pushManager.getSubscription();
  if (existing && madeWith(existing, publicKey) === false) await retire(existing);
  else if (existing) await existing.unsubscribe();
  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  } catch {
    throw new ReminderError("通知の登録に失敗しました。時間をおいて、もう一度試してください。");
  }
  const { endpoint, keys } = subscription.toJSON();
  try {
    if (!endpoint || !keys?.p256dh || !keys.auth) throw new ReminderError("このブラウザでは、リマインダーを受け取れません。");
    const state = await putPushSubscription(credential, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }, intervalMinutes);
    return { subscription, active: activeFrom(endpoint, state) };
  } catch (error) {
    // Nobody sends to it now; a later try makes a new one.
    await subscription.unsubscribe().catch(() => undefined);
    throw explain(error);
  }
}

/**
 * TRACE_B forgets it first, as the push worker does: a phone that let go only
 * locally would leave the endpoint on the server. A session already gone
 * (expired or deleted) took its subscription with it.
 */
export async function switchOffTraceReminder(credential: MemoryCredential, subscription: PushSubscription | null): Promise<void> {
  try {
    await deletePushSubscription(credential);
  } catch (error) {
    if (!(error instanceof TraceApiError && error.code === "UNAUTHORIZED")) throw explain(error);
  }
  await subscription?.unsubscribe().catch(() => undefined);
}

export async function changeTraceReminderInterval(credential: MemoryCredential, active: ActiveReminder, intervalMinutes: number): Promise<ActiveReminder> {
  try {
    return activeFrom(active.endpoint, await patchPushSubscription(credential, { intervalMinutes }));
  } catch (error) {
    throw explain(error);
  }
}
