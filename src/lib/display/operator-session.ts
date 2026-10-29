// Independent from renderer-link: only this opaque credential authorizes QR minting.
// Both Google identity and operator credential live solely in this instance's memory.
export type OperatorState = "login" | "authorizing" | "ready" | "revoking" | "error";
export type OperatorStatus = { state: OperatorState; detail: string | null };
type Credential = { operatorToken: string; credentialId: string; expiresAt: number };
export type ArrivalProof = { checkpointToken: string; expiresAt: number };

function googleExpiresAt(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch { return 0; }
}

export class OperatorSession {
  private googleToken: string | null = null;
  private credential: Credential | null = null;
  private issuing: Promise<Credential> | null = null;
  private loggingOut = false;
  private version = 0;
  private status: OperatorStatus = { state: "login", detail: null };

  private broker: string;
  private onStatus: (status: OperatorStatus) => void;
  private fetchImpl: typeof fetch;
  private now: () => number;

  constructor(broker: string, onStatus: (status: OperatorStatus) => void, fetchImpl: typeof fetch = fetch, now: () => number = Date.now) {
    this.broker = broker;
    this.onStatus = onStatus;
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.now = now;
  }

  private update(state: OperatorState, detail: string | null = null) {
    this.status = { state, detail };
    this.onStatus(this.status);
  }
  private async request(path: string, method: string, token: string): Promise<Response> {
    const response = await this.fetchImpl(`${this.broker}${path}`, { method, headers: { Authorization: `Bearer ${token}` }, cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      if (response.status === 401 && (path === "/arrival-token" || method === "DELETE")) this.credential = null;
      const code = typeof body?.error?.code === "string" ? body.error.code : `HTTP_${response.status}`;
      throw new Error(`運営認証: ${code}`);
    }
    return response;
  }

  async signIn(googleToken: string): Promise<void> {
    // Do not replace a still-valid credential without revoking it first.
    if (this.loggingOut || this.issuing || (this.credential && this.credential.expiresAt - this.now() > 15_000)) return;
    this.googleToken = googleToken;
    try { await this.ensureCredential(); } catch { /* State carries the real failure. */ }
  }

  private async ensureCredential(forRevocation = false): Promise<Credential> {
    if (this.loggingOut && !forRevocation) throw new Error("ログアウト中です。");
    if (this.credential && this.credential.expiresAt - this.now() > 15_000) return this.credential;
    if (this.issuing) return this.issuing;
    if (!this.googleToken || googleExpiresAt(this.googleToken) <= this.now() + 30_000) {
      if (!forRevocation) {
        this.credential = null;
        this.googleToken = null;
        this.update("login", "運営用に Google へ再ログインしてください。");
      }
      throw new Error("Google ログインが必要です。");
    }
    const version = this.version;
    const googleToken = this.googleToken;
    if (!this.loggingOut) this.update("authorizing");
    this.issuing = (async () => {
      try {
        const response = await this.request("/operator/credentials", "POST", googleToken);
        const body = await response.json();
        const expiresAt = Date.parse(body?.expiresAt);
        if (typeof body?.operatorToken !== "string" || !body.operatorToken || typeof body?.credentialId !== "string" || body.role !== "operator" || !Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new Error("運営資格の応答を確認できません。");
        const credential = { operatorToken: body.operatorToken, credentialId: body.credentialId, expiresAt };
        if (version !== this.version) throw new Error("認証が終了しました。");
        this.credential = credential;
        if (!this.loggingOut) this.update("ready");
        return credential;
      } catch (error) {
        if (version === this.version && !this.loggingOut) this.update("error", error instanceof Error ? error.message : "運営認証に失敗しました。");
        throw error;
      } finally { this.issuing = null; }
    })();
    return this.issuing;
  }

  async proof(): Promise<ArrivalProof> {
    if (this.status.state !== "ready" && this.status.state !== "authorizing") throw new Error("運営ログインが必要です。");
    const version = this.version;
    const credential = await this.ensureCredential();
    try {
      const response = await this.request("/arrival-token", "GET", credential.operatorToken);
      const body = await response.json();
      const expiresAt = Date.parse(body?.expiresAt);
      if (typeof body?.checkpointToken !== "string" || !body.checkpointToken || !Number.isFinite(expiresAt) || expiresAt <= this.now()) throw new Error("到着 QR の応答を確認できません。");
      if (version !== this.version || this.loggingOut) throw new Error("認証が終了しました。");
      return { checkpointToken: body.checkpointToken, expiresAt };
    } catch (error) {
      if (version === this.version && !this.loggingOut) this.update("error", error instanceof Error ? error.message : "到着 QR を取得できません。");
      throw error;
    }
  }

  async retry(): Promise<void> {
    if (this.loggingOut) return;
    try {
      await this.ensureCredential();
      this.update("ready");
    } catch { /* Keep explicit failure or login state. */ }
  }

  async logout(all = false): Promise<boolean> {
    if (this.loggingOut) return false;
    this.loggingOut = true;
    this.update("revoking");
    try {
      if (this.issuing) await this.issuing;
      if (all || (this.credential && this.credential.expiresAt <= this.now())) await this.ensureCredential(true);
      if (this.credential) await this.request(all ? "/operator/credentials" : "/operator/credentials/current", "DELETE", this.credential.operatorToken);
      this.version++;
      this.credential = null;
      this.googleToken = null;
      this.update("login");
      return true;
    } catch (error) {
      // Keep the credential for a real revocation retry; never claim a failed revoke succeeded.
      this.update("error", error instanceof Error ? error.message : "運営資格を失効できませんでした。");
      return false;
    } finally { this.loggingOut = false; }
  }

  close() {
    this.version++;
    this.credential = null;
    this.googleToken = null;
  }
}