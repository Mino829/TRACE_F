/**
 * Client for TRACE_B public config, memory-only experience creation and
 * status, and individual memory deletion. The /log demo does not create live
 * presence or upload photos to TRACE_B.
 *
 * The backend's URL comes from NEXT_PUBLIC_TRACE_API_URL. Unset, /log keeps
 * everything on the phone and the push worker, as before.
 *
 * /log joins memory-only: it never starts a live presence session, so the
 * create response carries neither a live token nor an experience link token.
 * The memory participant token is the only credential. It never goes into a
 * URL, a log or IndexedDB; session.ts keeps it in localStorage until the
 * memory session's deleteAfter, so that every tab of the browser continues
 * the same participation (privacy.md and api.md in trace-campus-installation,
 * decided in its #13; the earlier frontend-design.md 4.1 kept it in the tab's
 * sessionStorage).
 */

export const TRACE_API_URL = (process.env.NEXT_PUBLIC_TRACE_API_URL ?? "").replace(/\/$/, "");

const TIMEOUT_MS = 15_000;

export type AliasColor = "cyan" | "magenta" | "amber" | "violet" | "lime" | "coral";
export type AliasSymbol = "circle" | "triangle" | "diamond" | "star" | "wave" | "square";

/**
 * The colour and symbol the room's screen shows for this participant. Typed
 * as strings too, so a name the backend adds later reaches the screen as an
 * unknown one instead of failing.
 */
export type DisplayAlias = { color: AliasColor | (string & {}); symbol: AliasSymbol | (string & {}) };

export type PublicConfig = {
  registrationOpen: boolean;
  consent: { version: string; language: string; body: string };
  livePresenceConsentVersion: string;
  photo: { enabled: boolean; maxCount: number; maxUploadBytes: number; maxLongEdgePixels: number; publicDisplay: boolean };
  contact: string;
};

/** What authorizes reading the experience and deleting its memory. Kept apart from any other credential type. */
export type MemoryCredential = { memorySessionId: string; participantToken: string; expiresAt: string; deleteAfter: string };

export type CreatedExperience = {
  experienceId: string;
  memory: MemoryCredential;
  displayAlias: DisplayAlias;
};

/** GET /v1/experiences/{id} never returns a position or participant tokens. */
export type ExperienceStatus = {
  memorySession: { sessionId: string; expiresAt: string; deleteAfter: string };
  livePresenceSession?: { sessionId: string; trackingStatus: string; presencePhase: string; expiresAt: string; deleteAfter: string };
  displayAlias: DisplayAlias;
  photoSummary: { ready: number; pending: number; failed: number; maxCount: number };
};

/**
 * A failed request. `code` is the backend's error code, or NETWORK when the
 * request never got an answer; `requestId` is the one thing worth showing
 * from the body, for asking the team.
 */
export class TraceApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
  ) {
    super(messageFor(code, requestId));
    this.name = "TraceApiError";
  }
}

/** The text a participant sees, chosen by code; the server's own message is never shown. */
function messageFor(code: string, requestId: string | null): string {
  switch (code) {
    case "NETWORK":
      return "サーバーにつながりませんでした。電波の良い場所で、もう一度試してください。";
    case "REGISTRATION_CLOSED":
      return "いまは参加を受け付けていません。";
    case "CONSENT_VERSION_MISMATCH":
      return "参加の説明が新しくなりました。もう一度読んで、同意してください。";
    case "INVALID_CLIENT_TIME":
      return "スマホの時刻がずれています。時刻を合わせてから、もう一度試してください。";
    case "UNAUTHORIZED":
    case "NOT_FOUND":
      return "参加の記録が見つかりませんでした。期限が切れたか、削除されています。";
    default:
      return `サーバーで問題が起きました。時間をおいて、もう一度試してください。${requestId ? `（問い合わせ番号 ${requestId}）` : ""}`;
  }
}

type RequestOptions = { method?: "GET" | "POST" | "DELETE"; body?: unknown; token?: string; idempotencyKey?: string };

async function request<T>(path: string, { method = "GET", body, token, idempotencyKey }: RequestOptions = {}): Promise<T | null> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let response: Response;
  try {
    response = await fetch(`${TRACE_API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new TraceApiError(0, "NETWORK", null);
  }
  if (response.status === 204) return null;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: unknown; requestId?: unknown } } | null)?.error;
    throw new TraceApiError(
      response.status,
      typeof error?.code === "string" ? error.code : "UNKNOWN",
      typeof error?.requestId === "string" ? error.requestId : null,
    );
  }
  return payload as T;
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  const config = await request<PublicConfig>("/v1/public/config");
  if (!config || typeof config.registrationOpen !== "boolean" || typeof config.photo?.maxCount !== "number") {
    throw new TraceApiError(0, "UNKNOWN", null);
  }
  return config;
}

type CreateResponse = {
  experienceId: string;
  memorySession: { sessionId: string; participantToken: string; expiresAt: string; deleteAfter: string };
  displayAlias: DisplayAlias;
};

/**
 * Creates the experience the moment the participant agrees, memory-only, with
 * the consent versions exactly as the config gave them.
 */
export async function createExperience(config: PublicConfig): Promise<CreatedExperience> {
  const created = await request<CreateResponse>("/v1/experiences", {
    method: "POST",
    body: {
      memoryConsentVersion: config.consent.version,
      livePresenceConsentVersion: config.livePresenceConsentVersion,
      enableLivePresence: false,
      consentLanguage: config.consent.language,
      clientTime: new Date().toISOString(),
    },
  });
  if (!created?.memorySession?.participantToken || !created.memorySession.expiresAt || !created.memorySession.deleteAfter) {
    throw new TraceApiError(0, "UNKNOWN", null);
  }
  return {
    experienceId: created.experienceId,
    memory: { memorySessionId: created.memorySession.sessionId, participantToken: created.memorySession.participantToken,
      expiresAt: created.memorySession.expiresAt, deleteAfter: created.memorySession.deleteAfter },
    displayAlias: created.displayAlias,
  };
}

export async function getExperience(experienceId: string, credential: MemoryCredential): Promise<ExperienceStatus> {
  const status = await request<ExperienceStatus>(`/v1/experiences/${encodeURIComponent(experienceId)}`, { token: credential.participantToken });
  if (!status) throw new TraceApiError(0, "UNKNOWN", null);
  return status;
}

/** Answers 204 again for a repeat with the same key, so a retry after a lost answer is safe. */
export async function deleteMemorySession(credential: MemoryCredential, idempotencyKey: string): Promise<void> {
  await request(`/v1/memory-sessions/${encodeURIComponent(credential.memorySessionId)}`, {
    method: "DELETE",
    token: credential.participantToken,
    idempotencyKey,
  });
}
