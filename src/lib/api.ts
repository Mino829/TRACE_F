export interface PublicConfig {
  registrationOpen: boolean;
  consent: { version: string; language: string; body: string };
  livePresenceConsentVersion: string;
  onSiteConsentVersion: string;
  positionIntervalSeconds: number;
  livePositionTtlSeconds: number;
  photoLocationRetentionHours: number;
  photo: { enabled: boolean; maxCount: number };
  contact: string;
}

export interface Credential {
  sessionId: string;
  participantToken: string;
  expiresAt: string;
  deleteAfter: string;
}

export interface Experience {
  experienceId: string;
  memorySession: Credential;
  livePresenceSession?: Credential & { trackingStatus: string; presencePhase: string };
  displayAlias: { color: string; symbol: string };
  positionIntervalSeconds: number;
}

export interface ExperienceState {
  memorySession: Pick<Credential, "sessionId" | "expiresAt" | "deleteAfter">;
  livePresenceSession?: Pick<Credential, "sessionId" | "expiresAt" | "deleteAfter"> & { trackingStatus: string; presencePhase: string };
  displayAlias: Experience["displayAlias"];
  photoSummary: { ready: number; pending: number; failed: number; maxCount: number };
}

export interface DeleteResult {
  memory: "deleted" | "pending";
  live: "deleted" | "pending";
  complete: boolean;
}

const messages: Record<string, string> = {
  BACKEND_UNAVAILABLE: "サーバーに接続できません。しばらくしてから再度お試しください。",
  REGISTRATION_CLOSED: "現在、参加受付を休止しています。",
  CONSENT_VERSION_MISMATCH: "同意内容が更新されました。最新の内容を確認してください。",
  INVALID_CLIENT_TIME: "端末の日時を自動設定にしてからお試しください。",
  OUTSIDE_GEOFENCE: "展示の対象エリア外です。エリア内に移動すると送信できます。",
  LOW_ACCURACY: "位置の精度が足りません。屋外など測位しやすい場所でお試しください。",
  TOO_OLD: "新しい位置情報の取得を待っています。",
  FUTURE_TIME: "端末の時計が進んでいます。日時の自動設定を確認してください。",
  IMPOSSIBLE_JUMP: "位置が大きく変化したため、次の測位を待っています。",
  TRACKING_STOPPED: "この参加の位置送信は終了しています。",
  STATE_CONFLICT: "参加状態が変わりました。最新の状態を確認してください。",
  UNAUTHORIZED: "参加情報の期限が切れているか、利用できなくなっています。",
  NOT_FOUND: "参加情報が削除されているか、保存期限を過ぎています。",
  IDEMPOTENCY_CONFLICT: "操作を確認できませんでした。画面を更新してください。",
};

export class ApiError extends Error {
  constructor(public code: string, public status: number) {
    super(messages[code] ?? "操作を完了できませんでした。もう一度お試しください。");
  }
}

export async function api<T>(path: string, options: {
  method?: string; token?: string; liveToken?: string; body?: unknown; key?: string; signal?: AbortSignal;
} = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.liveToken) headers["X-Trace-Live-Token"] = options.liveToken;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Idempotency-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(`/api/backend${path}`, {
      method: options.method ?? "GET", headers, cache: "no-store",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError("BACKEND_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(result?.error?.code ?? "BACKEND_UNAVAILABLE", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作を完了できませんでした。";
}
