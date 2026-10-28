/**
 * Client for the push worker (push-worker/): subscribing this phone to the
 * photo reminder or the accuracy ping, sending each record, and withdrawing.
 *
 * The worker's URL comes from NEXT_PUBLIC_PUSH_API_URL (e.g. in .env.local).
 * While the tab holds a TRACE_B memory credential, the photo reminder goes
 * through TRACE_B instead (trace-api/reminder.ts).
 */

import type { LogEntry } from "./store";

export const PUSH_API_URL = (process.env.NEXT_PUBLIC_PUSH_API_URL ?? "").replace(/\/$/, "");

const DEVICE_KEY = "trace-device-id";
const EXPIRES_KEY = "trace-push-expires";
const PLAN_KEY = "trace-push-plan";

/**
 * What the phone's one subscription is for. A phone holds a single push
 * subscription, so turning on one plan replaces the other.
 *
 * - photo: the participants' optional reminder to take a photo, every 30 minutes.
 * - accuracy: the team's accuracy ping from the developer screen, every 10 minutes.
 */
export type PushPlan = { purpose: "photo" | "accuracy"; intervalMinutes: number };

/** The participants turn the reminder on or off, nothing more. The worker also takes 15 minutes, should the team want it. */
export const REMINDER_PLAN: PushPlan = { purpose: "photo", intervalMinutes: 30 };
export const ACCURACY_PLAN: PushPlan = { purpose: "accuracy", intervalMinutes: 10 };

/** A random id per browser, so the worker can tell one phone's records from another's. Not tied to the hardware. */
export function deviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return "unknown";
  }
}

/** After withdrawing, a later return starts as a stranger rather than as the same id. */
function forgetDeviceId(): void {
  try {
    window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Nothing stored.
  }
}

/** When the worker stops pinging this phone (midnight JST of the day it subscribed). */
export function subscriptionExpiresAt(): string | null {
  try {
    return window.localStorage.getItem(EXPIRES_KEY);
  } catch {
    return null;
  }
}

function saveExpiresAt(value: string | null): void {
  try {
    if (value) window.localStorage.setItem(EXPIRES_KEY, value);
    else window.localStorage.removeItem(EXPIRES_KEY);
  } catch {
    // Private mode.
  }
}

/**
 * The plan this phone last subscribed with. A subscription made before plans
 * existed has none stored; it was the ten-minute accuracy ping.
 */
export function subscriptionPlan(): PushPlan {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PLAN_KEY) ?? "null") as PushPlan | null;
    if ((stored?.purpose === "photo" || stored?.purpose === "accuracy") && typeof stored.intervalMinutes === "number") return stored;
  } catch {
    // Unreadable: fall through.
  }
  return ACCURACY_PLAN;
}

function savePlan(plan: PushPlan | null): void {
  try {
    if (plan) window.localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
    else window.localStorage.removeItem(PLAN_KEY);
  } catch {
    // Private mode.
  }
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Whether the browser made this subscription with the given VAPID public key:
 * the push worker's and TRACE_B's differ. Null where the browser does not say.
 */
export function madeWith(subscription: PushSubscription, publicKey: string): boolean | null {
  const own = subscription.options?.applicationServerKey;
  if (!own) return null;
  const mine = new Uint8Array(own);
  const theirs = base64UrlToBytes(publicKey);
  return mine.length === theirs.length && mine.every((byte, index) => byte === theirs[index]);
}

/** A fetch to the worker that never shows the browser's own words ("Load failed", "Failed to fetch") when the worker cannot be reached. */
async function reach(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${PUSH_API_URL}${path}`, init);
  } catch {
    throw new Error("通知サーバーにつながりませんでした。電波の良い場所で、もう一度試してください。");
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await reach(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`通知サーバーへの送信に失敗しました（${response.status}）。`);
  return response;
}

/** Subscribes this phone, or moves its subscription to another plan; the worker keeps one row per subscription. */
export async function subscribe(registration: ServiceWorkerRegistration, consentVersion: string, plan: PushPlan): Promise<PushSubscription> {
  const response = await reach("/vapid-public-key");
  if (!response.ok) throw new Error("通知サーバーに接続できませんでした。");
  const { publicKey } = (await response.json()) as { publicKey: string };
  // The browser holds one subscription and refuses a second key; one made for TRACE_B's reminder is let go here (TRACE_B drops it at its next send).
  const existing = await registration.pushManager.getSubscription();
  if (existing && madeWith(existing, publicKey) === false) await existing.unsubscribe();
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  const body = { subscription: subscription.toJSON(), deviceId: deviceId(), consentVersion, purpose: plan.purpose, intervalMinutes: plan.intervalMinutes };
  const { expiresAt } = (await (await post("/subscribe", body)).json()) as { expiresAt: string };
  saveExpiresAt(expiresAt);
  savePlan(plan);
  return subscription;
}

export async function unsubscribe(subscription: PushSubscription): Promise<void> {
  // Forget it on the server first: a phone that unsubscribed locally but not there would keep being pinged into the void.
  await post("/unsubscribe", { endpoint: subscription.endpoint });
  await subscription.unsubscribe();
  saveExpiresAt(null);
  savePlan(null);
}

/** The worker already dropped it at midnight; only the phone still holds it. */
export async function dropExpired(subscription: PushSubscription): Promise<void> {
  await subscription.unsubscribe().catch(() => undefined);
  saveExpiresAt(null);
  savePlan(null);
}

export async function sendTestPing(subscription: PushSubscription): Promise<void> {
  await post("/test", { endpoint: subscription.endpoint });
}

export async function uploadEntry(entry: LogEntry): Promise<void> {
  const form = new FormData();
  form.set("record", JSON.stringify(entry.record));
  if (entry.photo) form.set("photo", new File([entry.photo], `${entry.id}.jpg`, { type: "image/jpeg" }));
  const response = await reach("/records", { method: "POST", body: form });
  if (!response.ok) throw new Error(`送信に失敗しました（${response.status}）。`);
}

/** Deletes everything this phone sent, on the worker, and starts a fresh anonymous id. */
export async function forgetMe(): Promise<number> {
  const id = deviceId();
  let deleted = 0;
  if (id !== "unknown") {
    const response = await post("/forget", { deviceId: id });
    deleted = ((await response.json()) as { deletedRecords: number }).deletedRecords;
  }
  forgetDeviceId();
  saveExpiresAt(null);
  savePlan(null);
  return deleted;
}
