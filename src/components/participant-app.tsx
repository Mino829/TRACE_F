"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiError, errorMessage, type Experience, type ExperienceState, type PublicConfig } from "@/lib/api";
import { readSession, saveSession, type ParticipantSession } from "@/lib/session";
import { usePresence } from "@/hooks/use-presence";

function date(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

const colorNames: Record<string, string> = { cyan: "水色", magenta: "マゼンタ", amber: "琥珀色", violet: "紫", lime: "黄緑", coral: "コーラル" };
const symbols: Record<string, string> = { circle: "●", triangle: "▲", diamond: "◆", star: "★", wave: "〜", square: "■" };
const phases: Record<string, string> = { approaching: "キャンパスを歩いています", arrived: "展示場に到着しました", on_site: "会場内の体験に参加中", ended: "体験を終了しました" };

export default function ParticipantApp() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSession] = useState<ParticipantSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [liveAgreed, setLiveAgreed] = useState(false);
  const [onSiteAgreed, setOnSiteAgreed] = useState(false);
  const [wantsPosition, setWantsPosition] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<"memory" | "live" | "all" | null>(null);
  const locked = useRef(false);
  const tracking = session?.livePresenceSession?.trackingStatus === "tracking";
  const presence = usePresence(session, wantsPosition && tracking && !busy, config?.positionIntervalSeconds ?? 5);
  const expired = session ? Date.parse(session.expiresAt) <= presence.clock : false;
  const active = !!session?.livePresenceSession && tracking && !expired;

  const persist = useCallback((value: ParticipantSession | null) => {
    saveSession(value);
    setSession(value);
  }, []);

  const loadConfig = useCallback(async () => {
    setError("");
    try {
      setConfig(await api<PublicConfig>("/v1/public/config"));
      setSession(readSession());
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setReady(true); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const stored = readSession();
        const settings = await api<PublicConfig>("/v1/public/config");
        if (cancelled) return;
        setSession(stored);
        setConfig(settings);
      } catch (failure) {
        if (!cancelled) setError(errorMessage(failure));
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void initialize();
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async (current: ParticipantSession) => {
    if (current.memoryDeleted) return;
    const state = await api<ExperienceState>(`/v1/experiences/${current.experienceId}`, { token: current.memorySession.participantToken });
    persist({ ...current, displayAlias: state.displayAlias, expiresAt: state.expiresAt, deleteAfter: state.deleteAfter,
      livePresenceSession: state.livePresenceSessionId && current.livePresenceSession
        ? { ...current.livePresenceSession, trackingStatus: state.trackingStatus ?? "stopped", presencePhase: state.presencePhase ?? "ended" }
        : undefined });
  }, [persist]);

  const experienceId = session?.experienceId;
  const memoryDeleted = session?.memoryDeleted;
  const memoryToken = session?.memorySession.participantToken;
  const pendingMemoryDelete = !!session?.operationKeys["delete-memory"] && !memoryDeleted;
  useEffect(() => {
    if (!experienceId || !memoryToken || memoryDeleted || pendingMemoryDelete || busy) return;
    let disposed = false;
    const controller = new AbortController();
    async function check() {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const state = await api<ExperienceState>(`/v1/experiences/${experienceId}`, { token: memoryToken, signal: controller.signal });
        if (disposed) return;
        setSession((current) => {
          if (!current || current.experienceId !== experienceId) return current;
          const updated = { ...current, expiresAt: state.expiresAt, deleteAfter: state.deleteAfter,
            livePresenceSession: state.livePresenceSessionId && current.livePresenceSession
              ? { ...current.livePresenceSession, trackingStatus: state.trackingStatus ?? "stopped", presencePhase: state.presencePhase ?? "ended" }
              : undefined };
          saveSession(updated);
          return updated;
        });
      } catch (failure) {
        if (!disposed) {
          setError(errorMessage(failure));
          if (failure instanceof ApiError && ["NOT_FOUND", "UNAUTHORIZED"].includes(failure.code)) setWantsPosition(false);
        }
      }
    }
    void check();
    const timer = setInterval(check, 15000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [experienceId, memoryDeleted, memoryToken, pendingMemoryDelete, busy]);

  async function run(label: string, action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(label); setError(""); setNotice("");
    try { await action(); }
    catch (failure) {
      setError(errorMessage(failure));
      if (failure instanceof ApiError && failure.code === "CONSENT_VERSION_MISMATCH") {
        setAgreed(false); setLiveAgreed(false); setOnSiteAgreed(false);
        await loadConfig();
        setError(errorMessage(failure));
      }
    } finally { locked.current = false; setBusy(""); }
  }

  function withKey(current: ParticipantSession, operation: string): ParticipantSession {
    const updated = { ...current, operationKeys: { ...current.operationKeys, [operation]: current.operationKeys[operation] ?? crypto.randomUUID() } };
    persist(updated);
    return updated;
  }

  async function create() {
    if (!config || !agreed || !config.registrationOpen) return;
    await run("参加を開始しています…", async () => {
      sessionStorage.setItem("trace.storage-check", "1");
      sessionStorage.removeItem("trace.storage-check");
      const result = await api<Experience>("/v1/experiences", { method: "POST", body: {
        memoryConsentVersion: config.consent.version,
        livePresenceConsentVersion: liveAgreed ? config.livePresenceConsentVersion : "",
        enableLivePresence: liveAgreed, consentLanguage: config.consent.language, clientTime: new Date().toISOString(),
      } });
      persist({ ...result, operationKeys: {} });
      setNotice("参加を開始しました。位置情報は「位置送信を開始」から許可してください。");
    });
  }

  async function stop() {
    if (!session?.livePresenceSession) return;
    setWantsPosition(false);
    await run("位置送信を終了しています…", async () => {
      const current = withKey(session, "stop");
      const live = current.livePresenceSession!;
      await api(`/v1/live-presence-sessions/${live.sessionId}/stop`, { method: "POST", token: live.participantToken,
        key: current.operationKeys.stop, body: { reason: "participant_requested" } });
      persist({ ...current, livePresenceSession: { ...live, trackingStatus: "stopped", presencePhase: "ended" } });
      setNotice("位置送信を終了し、サーバーの最新位置を消去しました。");
    });
  }

  async function onSite() {
    if (!session?.livePresenceSession || !config || !onSiteAgreed) return;
    await run("会場内の体験へ切り替えています…", async () => {
      const live = session.livePresenceSession!;
      await api(`/v1/live-presence-sessions/${live.sessionId}/on-site`, { method: "POST", token: live.participantToken,
        body: { continue: true, consentVersion: config.onSiteConsentVersion } });
      persist({ ...session, livePresenceSession: { ...live, presencePhase: "on_site" } });
      setNotice("会場内の体験に切り替えました。位置はエリア単位の表現に使われます。");
    });
  }

  async function remove(kind: "memory" | "live" | "all") {
    if (!session) return;
    setWantsPosition(false);
    await run("参加データを削除しています…", async () => {
      let current = session;
      // Memory deletion does not cascade to live presence in the Go API.
      for (const target of kind === "all" ? ["live", "memory"] : [kind]) {
        if (target === "live" && !current.livePresenceSession) continue;
        if (target === "memory" && current.memoryDeleted) continue;
        current = withKey(current, `delete-${target}`);
        const credential = target === "live" ? current.livePresenceSession! : current.memorySession;
        try {
          await api(`/v1/${target === "live" ? "live-presence" : "memory"}-sessions/${credential.sessionId}`, {
            method: "DELETE", token: credential.participantToken, key: current.operationKeys[`delete-${target}`],
          });
        } catch (failure) {
          if (!(failure instanceof ApiError && failure.code === "UNAUTHORIZED" && Date.parse(current.deleteAfter) <= Date.now())) throw failure;
        }
        current = target === "live" ? { ...current, livePresenceSession: undefined } : { ...current, memoryDeleted: true };
        persist(current);
      }
      if (current.memoryDeleted && !current.livePresenceSession) {
        persist(null); setAgreed(false); setLiveAgreed(false); setOnSiteAgreed(false);
      }
      setConfirmDelete(null);
      setNotice(kind === "all" ? "この参加のデータをすべて削除しました。" : "選択した参加データを削除しました。");
    });
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link href="/" className="wordmark" aria-label="TRACE ホーム">TRACE<span className="wordmark-dot" /></Link>
        <span className="edition">CAMPUS EXPERIENCE <span className="edition-number">01</span></span>
      </header>
      <main className="main-grid">
        <section className="intro">
          <p className="eyebrow"><span className="tiny-line" /> EVERY STEP LEAVES A TRACE</p>
          <h1>歩いた時間が、<br />光になる。</h1>
          <p className="intro-copy">何気ない一歩も、立ち止まった瞬間も。<br />キャンパスで過ごすあなたの時間が、<br />展示のなかでひとつの光になります。</p>
          <div className="route-art" aria-hidden="true">
            <svg viewBox="0 0 560 300" fill="none">
              <defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#c9c9bc" /></pattern></defs>
              <rect width="560" height="300" fill="url(#grid)" />
              <path d="M20 218H117V176H187V96H306V150H387V75H523" stroke="#d7d6cb" strokeWidth="1" />
              <path d="M55 273V218H117V176H187V96H306V150H387V75H482" stroke="#e96f3c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="55" cy="273" r="5" fill="#e96f3c" /><circle cx="187" cy="96" r="6" fill="#faf9f3" stroke="#e96f3c" strokeWidth="2" />
              <circle cx="306" cy="150" r="6" fill="#faf9f3" stroke="#e96f3c" strokeWidth="2" />
              <circle cx="482" cy="75" r="24" fill="#e96f3c" fillOpacity=".08" /><circle cx="482" cy="75" r="12" fill="#e96f3c" fillOpacity=".15" /><circle cx="482" cy="75" r="5" fill="#e96f3c" />
              <text x="72" y="273" className="art-label">YOUR FIRST STEP</text><text x="417" y="40" className="art-label">BECOMES LIGHT</text>
            </svg>
          </div>
          <div className="intro-foot"><span>あなたのペースで。あなたの一歩から。</span><span>↗</span></div>
        </section>
        <section className="experience-panel" aria-label={session ? "参加状況" : "参加の準備"}>
          <div className="panel-top"><span className="eyebrow">{session ? "YOUR EXPERIENCE" : "BEFORE YOU BEGIN"}</span><span className="step-number">{session ? "02 / 02" : "01 / 02"}</span></div>
          <div aria-live="polite" aria-atomic="true">
            {error && <div className="message error" role="alert">{error}</div>}
            {notice && <div className="message success">{notice}</div>}
          </div>
          {!ready && <div className="loading"><span className="status-dot pulse" /> 参加受付を確認しています…</div>}
          {ready && !config && <div className="connection-state"><h2>接続を確認してください</h2><p>参加受付の情報を取得できませんでした。</p><button className="primary-button" onClick={loadConfig}>もう一度接続する <span>↻</span></button></div>}
          {ready && config && !session && <>
            <h2>体験をはじめる</h2>
            <p className="panel-description">参加する前に、データの使い方をご確認ください。</p>
            <div className="consent-copy"><p>{config.consent.body}</p><div className="retention-row"><span>データの保存期間</span><strong>参加期限の {config.photoLocationRetentionHours} 時間後まで</strong></div></div>
            <label className="consent-option"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} disabled={!!busy} /><span><strong>内容を確認し、参加に同意します</strong><small>参加情報は匿名で管理されます。</small></span></label>
            <label className="consent-option live-option"><input type="checkbox" checked={liveAgreed} onChange={(event) => setLiveAgreed(event.target.checked)} disabled={!!busy} /><span><strong>位置情報を使った光の表現に参加する <em>任意</em></strong><small>画面を開いている間、約{config.positionIntervalSeconds}秒ごとに現在地を送ります。生の位置履歴は保存せず、最新の表示位置は{config.livePositionTtlSeconds}秒で消去されます。</small></span></label>
            <div className="feature-note"><span className="outline-icon">◎</span><p>写真メモリーは準備中です。<br /><span>現在は位置情報による体験をお試しいただけます。</span></p></div>
            <button className="primary-button" disabled={!agreed || !config.registrationOpen || !!busy} onClick={create}>{busy || (config.registrationOpen ? "同意して参加する" : "ただいま受付を休止しています")}<span>↗</span></button>
            <p className="permission-note">位置情報の許可は、参加後にご自身の操作で行います。</p>
          </>}
          {ready && config && session && <>
            {pendingMemoryDelete && <div className="message error">前回の削除が完了したか確認できていません。削除操作を再度実行すると、同じ操作の結果を確認できます。</div>}
            <h2>{expired ? "参加期限が終了しました" : "あなたの一歩を、展示へ。"}</h2>
            <p className="panel-description">{session.livePresenceSession ? phases[session.livePresenceSession.presencePhase] ?? "参加状態を確認しています" : "位置情報を使わずに参加しています。"}</p>
            <div className="alias-card"><span className={`alias-symbol alias-${session.displayAlias.color}`}>{symbols[session.displayAlias.symbol] ?? "●"}</span><div><small>展示でのあなたの目印</small><strong>{colorNames[session.displayAlias.color] ?? session.displayAlias.color}</strong></div><span className="anonymous-tag">ANONYMOUS</span></div>
            {session.livePresenceSession && <div className="presence-card">
              <div className="status-heading"><span className={`status-dot ${presence.fresh ? "is-live" : ""}`} /><strong>{!active ? "位置送信は終了しています" : wantsPosition && !busy ? "位置情報の参加中" : "位置送信は一時停止中"}</strong></div>
              <p role="status">{active ? presence.message : "現在地は送信されません。"}</p>
              {presence.lastAccepted && <dl className="position-details"><div><dt>最終送信</dt><dd>{date(presence.lastAccepted.at)}</dd></div><div><dt>測位精度</dt><dd>約 {Math.round(presence.lastAccepted.accuracy)} m</dd></div><div><dt>サーバーの最新位置</dt><dd>{presence.fresh ? "保持中" : "保持を終了"}</dd></div></dl>}
              {active && <div className="button-row"><button className="primary-button" disabled={!!busy} onClick={() => setWantsPosition(!wantsPosition)}>{wantsPosition ? "端末からの送信を一時停止" : "位置送信を開始"}<span>{wantsPosition ? "Ⅱ" : "↗"}</span></button><button className="text-button" disabled={!!busy} onClick={stop}>この参加の位置送信を終了する</button></div>}
              <small className="muted">一時停止中の表示位置は最大{config.livePositionTtlSeconds}秒で消去されます。「終了」は即時消去し、この参加では再開しません。</small>
            </div>}
            {active && session.livePresenceSession?.presencePhase !== "on_site" && <div className="on-site-card"><p className="eyebrow">AT THE EXHIBITION</p><h3>展示場に着いたら</h3><p>会場内では位置をエリア単位の表現に使います。引き続き参加する場合は、ここで同意してください。</p><label className="inline-check"><input type="checkbox" checked={onSiteAgreed} onChange={(event) => setOnSiteAgreed(event.target.checked)} disabled={!!busy} />会場内の位置表現に同意する</label><button className="secondary-button" disabled={!onSiteAgreed || !!busy} onClick={onSite}>会場内の体験へ進む <span>→</span></button></div>}
            <div className="session-dates"><span>参加期限 <strong>{date(session.expiresAt)}</strong></span><span>データ削除期限 <strong>{date(session.deleteAfter)}</strong></span></div>
            <div className="manage-section"><h3>参加データの管理</h3><p>写真メモリーと位置情報の参加は、個別に削除できます。</p><div className="manage-links">
              {!session.memoryDeleted && <button disabled={!!busy} onClick={() => setConfirmDelete("memory")}>メモリー参加情報を削除</button>}
              {session.livePresenceSession && <button disabled={!!busy} onClick={() => setConfirmDelete("live")}>位置参加情報を削除</button>}
              <button disabled={!!busy} onClick={() => setConfirmDelete("all")}>すべて削除して終了</button>
            </div></div>
            {confirmDelete && <div className="delete-confirm" role="group" aria-label="削除の確認"><strong>{confirmDelete === "all" ? "この参加のデータをすべて削除しますか？" : confirmDelete === "live" ? "位置情報の参加を削除しますか？" : "メモリー参加情報を削除しますか？"}</strong><p>{confirmDelete === "memory" && session.livePresenceSession ? "位置情報の参加は残ります。両方を消す場合は「すべて削除して終了」を選んでください。" : "削除したデータは元に戻せません。"}</p><div className="confirm-actions"><button className="danger-button" disabled={!!busy} onClick={() => remove(confirmDelete)}>{busy || "削除する"}</button><button className="secondary-button" disabled={!!busy} onClick={() => setConfirmDelete(null)}>キャンセル</button></div></div>}
            {!session.memoryDeleted && <button className="text-button refresh-button" disabled={!!busy} onClick={() => run("状態を確認しています…", () => refresh(session))}>参加状態を更新 ↻</button>}
          </>}
          {config && <div className="contact"><span>お困りのときは</span><p>{config.contact}</p></div>}
        </section>
      </main>
      <footer className="site-footer"><span>TRACE — CAMPUS MOVEMENT INSTALLATION</span><span>A MOMENT. A WALK. A TRACE.</span></footer>
    </div>
  );
}
