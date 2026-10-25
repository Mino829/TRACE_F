/**
 * This browser's experience with the backend, kept in localStorage until the
 * memory session's deleteAfter, as the work's docs decided (privacy.md and
 * api.md in trace-campus-installation, from its #13): a reload, another tab,
 * a notification, or opening /log again after closing the tab all continue
 * the same participation. The memory credential sits under its own key, the
 * rest of what the create response returned (never a photo) under another,
 * and the idempotency keys of the participant's actions under a third.
 *
 * All three go when the participant withdraws, when the backend no longer
 * knows the credential, and once deleteAfter has passed, when the backend has
 * deleted the participation by itself. Another browser, the other side of
 * Safari and the home-screen app, or a closed private window never had them:
 * the participation cannot be picked up there.
 */

import { withLock } from "@/lib/ping-log/tabs";

import type { DisplayAlias, ExperienceStatus, MemoryCredential } from "./client";

const CREDENTIAL_KEY = "trace-memory-credential";
const EXPERIENCE_KEY = "trace-experience";
const ACTIONS_KEY = "trace-memory-actions";

/** How long an action waits for another tab sending the same one. */
const SEND_WAIT_MS = 15_000;

/** What the browser knows about its experience besides the credential. */
export type ExperienceInfo = {
  experienceId: string;
  displayAlias: DisplayAlias;
  consentVersion: string;
  createdAt: string;
};

export type TabExperience = ExperienceInfo & { memory: MemoryCredential };

function read<T>(key: string): T | null {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage refused: the experience lasts as long as the page.
  }
}

function readStored(): TabExperience | null {
  const memory = read<MemoryCredential>(CREDENTIAL_KEY);
  const info = read<ExperienceInfo>(EXPERIENCE_KEY);
  if (!memory?.participantToken || !memory.memorySessionId || !memory.expiresAt || !memory.deleteAfter || !info?.experienceId) return null;
  return { experienceId: info.experienceId, displayAlias: info.displayAlias, consentVersion: info.consentVersion, createdAt: info.createdAt, memory };
}

function lapsed(experience: TabExperience, now: number): boolean {
  return Date.parse(experience.memory.deleteAfter) <= now;
}

/** The participation this browser can continue: past its deleteAfter, there is none. */
export function loadTabExperience(now = Date.now()): TabExperience | null {
  const stored = readStored();
  return stored && !lapsed(stored, now) ? stored : null;
}

/** Whether the stored participation is past its deleteAfter, so the backend has deleted it. */
export function experienceLapsed(now = Date.now()): boolean {
  const stored = readStored();
  return !!stored && lapsed(stored, now);
}

/** Forgets a participation the backend has already deleted for its period; true when there was one. */
export function forgetLapsedExperience(now = Date.now()): boolean {
  if (!experienceLapsed(now)) return false;
  clearTabExperience();
  return true;
}

export function saveTabExperience({ memory, ...info }: TabExperience): void {
  write(CREDENTIAL_KEY, memory);
  write(EXPERIENCE_KEY, info);
}

/** Keeps the credential and swaps in what the backend now says about the experience. */
export function updateTabExperience(experience: TabExperience, update: ExperienceStatus): TabExperience {
  if (experience.memory.memorySessionId !== update.memorySession.sessionId) {
    throw new Error("参加情報の確認に失敗しました。削除するための情報は、このブラウザに残しています。");
  }
  const next = { ...experience, displayAlias: update.displayAlias, memory: {
    ...experience.memory, expiresAt: update.memorySession.expiresAt, deleteAfter: update.memorySession.deleteAfter,
  } };
  saveTabExperience(next);
  return next;
}

export function clearTabExperience(): void {
  write(CREDENTIAL_KEY, null);
  write(EXPERIENCE_KEY, null);
  write(ACTIONS_KEY, null);
}

/** One action on a memory session: the key every try sends, the request it was made for, and the first answer once one came. */
type Action = { key: string; input: string; done?: { result: unknown } };
type Actions = { memorySessionId: string; actions: Record<string, Action> };

function readActions(memorySessionId: string): Record<string, Action> {
  const stored = read<Actions>(ACTIONS_KEY);
  return stored?.memorySessionId === memorySessionId ? stored.actions : {};
}

function writeAction(memorySessionId: string, name: string, action: Action): void {
  write(ACTIONS_KEY, { memorySessionId, actions: { ...readActions(memorySessionId), [name]: action } });
}

/**
 * The idempotency key for one action on this memory session, made before the
 * first try and reused by every retry of the same request, in any tab and
 * after a reload. A request with other content (a fresh QR code, say) gets a
 * new key: the backend answers a reused key with other content with
 * IDEMPOTENCY_CONFLICT.
 */
export function actionKey(memorySessionId: string, name: string, input: unknown = null): string {
  const text = JSON.stringify(input);
  const stored = readActions(memorySessionId)[name];
  if (stored && stored.input === text) return stored.key;
  const key = crypto.randomUUID();
  writeAction(memorySessionId, name, { key, input: text });
  return key;
}

/** The key for deleting this memory session, reused by every retry until the delete is known to have happened. */
export function memoryDeleteKey(memorySessionId: string): string {
  return actionKey(memorySessionId, "delete");
}

/**
 * Sends an action that counts once per memory session, such as the arrival.
 * One tab sends at a time; a retry of the same request reuses its key; and
 * once a try has been answered, every later call, in any tab and after a
 * reload, gets that first answer without asking the backend again. Rejects
 * with LockTimeout when another tab has been sending it for too long.
 */
export function sendOnce<T>(memorySessionId: string, name: string, input: unknown, send: (idempotencyKey: string) => Promise<T>): Promise<T> {
  return withLock(
    `trace-once:${name}`,
    async () => {
      const done = readActions(memorySessionId)[name]?.done;
      if (done) return done.result as T;
      const key = actionKey(memorySessionId, name, input);
      const result = await send(key);
      writeAction(memorySessionId, name, { key, input: JSON.stringify(input), done: { result } });
      return result;
    },
    { waitMs: SEND_WAIT_MS },
  );
}
