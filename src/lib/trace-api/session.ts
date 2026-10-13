/**
 * This tab's experience with the backend, kept in sessionStorage as
 * frontend-design.md 4.1 and 5.1 ask: the memory credential under its own key,
 * the rest of what the create response returned (never a position, never a
 * photo) under another, and the delete's idempotency key under a third. A
 * reload of the tab keeps them; another tab, or the phone's home-screen app,
 * starts without them and has to join again.
 */

import type { DisplayAlias, MemoryCredential } from "./client";

const CREDENTIAL_KEY = "trace-memory-credential";
const EXPERIENCE_KEY = "trace-experience";
const DELETE_KEY = "trace-memory-delete-key";

/** What the tab knows about its experience besides the credential. */
export type ExperienceInfo = {
  experienceId: string;
  displayAlias: DisplayAlias;
  expiresAt: string;
  deleteAfter: string;
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
  const memory = read<MemoryCredential>(CREDENTIAL_KEY);
  const info = read<ExperienceInfo>(EXPERIENCE_KEY);
  if (!memory?.participantToken || !memory.memorySessionId || !info?.experienceId) return null;
  return { ...info, memory };
}

export function saveTabExperience({ memory, ...info }: TabExperience): void {
  write(CREDENTIAL_KEY, memory);
  write(EXPERIENCE_KEY, info);
}

/** Keeps the credential and swaps in what the backend now says about the experience. */
export function updateTabExperience(experience: TabExperience, update: Pick<ExperienceInfo, "displayAlias" | "expiresAt" | "deleteAfter">): TabExperience {
  const next = { ...experience, ...update };
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
