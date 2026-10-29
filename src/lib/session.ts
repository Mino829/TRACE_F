import type { Experience } from "./api";

const storageKey = "trace.participant.v1";

export interface ParticipantSession extends Experience {
  operationKeys: Record<string, string>;
  memoryDeleted?: boolean;
  deleteResult?: { memory: "deleted" | "pending"; live: "deleted" | "pending" };
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
    // Existing open tabs may still hold the previous shared experience expiry.
    if (typeof value.expiresAt === "string" && typeof value.deleteAfter === "string") {
      for (const session of [value.memorySession, value.livePresenceSession]) {
        if (session && !session.expiresAt) session.expiresAt = value.expiresAt;
        if (session && !session.deleteAfter) session.deleteAfter = value.deleteAfter;
      }
      delete value.expiresAt;
      delete value.deleteAfter;
      saveSession(value);
    }
    const credential = (v: { sessionId?: unknown; participantToken?: unknown; expiresAt?: unknown; deleteAfter?: unknown }) =>
      v && typeof v.sessionId === "string" && typeof v.participantToken === "string" &&
      typeof v.expiresAt === "string" && Number.isFinite(Date.parse(v.expiresAt)) &&
      typeof v.deleteAfter === "string" && Number.isFinite(Date.parse(v.deleteAfter));
    if (typeof value.experienceId !== "string" || !credential(value.memorySession) ||
      (value.livePresenceSession && !credential(value.livePresenceSession))) {
      saveSession(null);
      return null;
    }
    const now = Date.now();
    const memoryExpired = Date.parse(value.memorySession.deleteAfter) <= now;
    const liveExpired = value.livePresenceSession && Date.parse(value.livePresenceSession.deleteAfter) <= now;
    if (memoryExpired) value.memoryDeleted = true;
    if (liveExpired) delete value.livePresenceSession;
    if (value.memoryDeleted && !value.livePresenceSession) {
      saveSession(null);
      return null;
    }
    const operationKeys = { ...value.operationKeys };
    if (memoryExpired || liveExpired) {
      delete operationKeys["delete-all"];
      delete value.deleteResult;
    }
    if (value.memoryDeleted) delete operationKeys["delete-memory"];
    if (!value.livePresenceSession) delete operationKeys["delete-live"];
    const result = { ...value, operationKeys } as ParticipantSession;
    if (memoryExpired || liveExpired) saveSession(result);
    return result;
  } catch {
    saveSession(null);
    return null;
  }
}
