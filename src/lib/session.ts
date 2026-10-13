import type { Experience } from "./api";

const storageKey = "trace.participant.v1";

export interface ParticipantSession extends Experience {
  operationKeys: Record<string, string>;
  memoryDeleted?: boolean;
}

export function saveSession(session: ParticipantSession | null) {
  if (session) sessionStorage.setItem(storageKey, JSON.stringify(session));
  else sessionStorage.removeItem(storageKey);
}

export function readSession(): ParticipantSession | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const credential = (v: { sessionId?: unknown; participantToken?: unknown }) =>
      v && typeof v.sessionId === "string" && typeof v.participantToken === "string";
    if (typeof value.experienceId !== "string" || !credential(value.memorySession) ||
      (value.livePresenceSession && !credential(value.livePresenceSession)) ||
      !Number.isFinite(Date.parse(value.expiresAt)) || !Number.isFinite(Date.parse(value.deleteAfter)) ||
      Date.parse(value.deleteAfter) <= Date.now() || !value.displayAlias) {
      saveSession(null);
      return null;
    }
    return { ...value, operationKeys: value.operationKeys ?? {} };
  } catch {
    saveSession(null);
    return null;
  }
}
