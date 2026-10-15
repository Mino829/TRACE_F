/**
 * This tab's experience with the backend, kept in sessionStorage as
 * frontend-design.md 4.1 and 5.1 ask: the memory credential under its own key,
 * the rest of what the create response returned (never a position, never a
 * photo) under another, and the delete's idempotency key under a third. A
 * reload of the tab keeps them; another tab, or the phone's home-screen app,
 * starts without them and has to join again.
 */

import type { DisplayAlias, ExperienceStatus, MemoryCredential } from "./client";

const CREDENTIAL_KEY = "trace-memory-credential";
const EXPERIENCE_KEY = "trace-experience";
const DELETE_KEY = "trace-memory-delete-key";

/** What the tab knows about its experience besides the credential. */
export type ExperienceInfo = {
  experienceId: string;
  displayAlias: DisplayAlias;
  consentVersion: string;
  createdAt: string;
};

export type TabExperience = ExperienceInfo & { memory: MemoryCredential };

function read<T>(key: string): T | null {
  try {
    return JSON.parse(window.sessionStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage refused: the experience lasts as long as the page.
  }
}

export function loadTabExperience(): TabExperience | null {
  const stored = read<MemoryCredential>(CREDENTIAL_KEY);
  const info = read<ExperienceInfo & { expiresAt?: string; deleteAfter?: string }>(EXPERIENCE_KEY);
  if (!stored?.participantToken || !stored.memorySessionId || !info?.experienceId) return null;
  const memory = { ...stored, expiresAt: stored.expiresAt ?? info.expiresAt, deleteAfter: stored.deleteAfter ?? info.deleteAfter };
  if (!memory.expiresAt || !memory.deleteAfter) return null;
  return { experienceId: info.experienceId, displayAlias: info.displayAlias,
    consentVersion: info.consentVersion, createdAt: info.createdAt, memory };
}

export function saveTabExperience({ memory, ...info }: TabExperience): void {
  write(CREDENTIAL_KEY, memory);
  write(EXPERIENCE_KEY, info);
}

/** Keeps the credential and swaps in what the backend now says about the experience. */
export function updateTabExperience(experience: TabExperience, update: ExperienceStatus): TabExperience {
  if (experience.memory.memorySessionId !== update.memorySession.sessionId) {
    throw new Error("参加情報の確認に失敗しました。削除するための情報はこのタブに保持されています。");
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
  write(DELETE_KEY, null);
}

/**
 * The key for deleting this memory session, made before the first try and
 * reused by every retry until the delete is known to have happened.
 */
export function memoryDeleteKey(memorySessionId: string): string {
  const stored = read<{ memorySessionId: string; key: string }>(DELETE_KEY);
  if (stored?.memorySessionId === memorySessionId) return stored.key;
  const key = crypto.randomUUID();
  write(DELETE_KEY, { memorySessionId, key });
  return key;
}
