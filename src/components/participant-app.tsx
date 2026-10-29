"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ApiError, api, errorMessage, type DeleteResult, type ExperienceState, type LiveState, type MemoryStopResult, type PublicConfig } from "@/lib/api";
import { readSession, saveSession, type ParticipantSession } from "@/lib/session";

function date(value: string) {
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function fromState(current: ParticipantSession, state: ExperienceState): ParticipantSession {
  return {
    ...current,
    memorySession: { ...current.memorySession, ...state.memorySession },
  };
}

export default function ParticipantApp() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSession] = useState<ParticipantSession | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(Date.now);
  const [busy, setBusy] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<"memory" | "live" | "all" | null>(null);
  const locked = useRef(false);
  const tracking = session?.livePresenceSession?.trackingStatus === "tracking";
  const pendingDelete = !!session && !!(session.operationKeys["delete-all"] || session.operationKeys["delete-memory"] || session.operationKeys["delete-live"]);
  const active = !!session?.livePresenceSession && tracking && Date.parse(session.livePresenceSession.expiresAt) > clock;
  const memoryEnded = !!session && (session.memorySession.status === "ended" || Date.parse(session.memorySession.expiresAt) <= clock);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const persist = useCallback((value: ParticipantSession | null) => {
    saveSession(value);
    setSession(value);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      try {
        const stored = readSession();
        if (!cancelled) setSession(stored);
        const settings = await api<PublicConfig>("/v1/public/config");
        if (cancelled) return;
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

  const readCurrent = useCallback(async (current: ParticipantSession, signal?: AbortSignal) => {
    let next = current;
    if (!current.memoryDeleted) {
      try {
        const state = await api<ExperienceState>(`/v1/experiences/${current.experienceId}`, { token: current.memorySession.participantToken, signal });
        next = fromState(current, state);
      } catch (failure) {
        if (!(failure instanceof ApiError) || failure.code !== "NOT_FOUND" && failure.code !== "UNAUTHORIZED") throw failure;
        next = { ...current, memoryDeleted: true };
      }
    }
    const live = current.livePresenceSession;
    if (live) {
      try {
        const state = await api<LiveState>(`/v1/live-presence-sessions/${live.sessionId}`, { token: live.participantToken, signal });
        next = { ...next, livePresenceSession: { ...live, ...state } };
      } catch (failure) {
        if (!(failure instanceof ApiError) || failure.code !== "NOT_FOUND" && failure.code !== "UNAUTHORIZED") throw failure;
        next = { ...next, livePresenceSession: undefined };
      }
    }
    return next.memoryDeleted && !next.livePresenceSession ? null : next;
  }, []);

  const refresh = useCallback(async (current: ParticipantSession) => {
    if (current.operationKeys["delete-all"] || current.operationKeys["delete-memory"] || current.operationKeys["delete-live"]) return;
    persist(await readCurrent(current));
  }, [persist, readCurrent]);

  const experienceId = session?.experienceId;
  const memoryDeleted = session?.memoryDeleted;
  const memoryToken = session?.memorySession.participantToken;
  useEffect(() => {
    if (!experienceId || !memoryToken || pendingDelete || busy) return;
    let disposed = false;
    const controller = new AbortController();
    async function check() {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      try {
        const current = readSession();
        if (!current || current.experienceId !== experienceId) return;
        const updated = await readCurrent(current, controller.signal);
        if (disposed) return;
        persist(updated);
      } catch (failure) {
        if (!disposed) {
          setError(errorMessage(failure));
        }
      }
    }
    void check();
    const timer = setInterval(check, 15000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [experienceId, memoryDeleted, memoryToken, pendingDelete, busy, persist, readCurrent]);

  async function run(label: string, action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(label); setError(""); setNotice("");
    try { await action(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { locked.current = false; setBusy(""); }
  }

  function withKey(current: ParticipantSession, operation: string): ParticipantSession {
    const updated = { ...current, operationKeys: { ...current.operationKeys, [operation]: current.operationKeys[operation] ?? crypto.randomUUID() } };
    persist(updated);
    return updated;
  }

  async function stopLive() {
    if (!session?.livePresenceSession) return;
    await run("位置送信を終了しています…", async () => {
      const current = withKey(session, "stop");
      const live = current.livePresenceSession!;
      await api(`/v1/live-presence-sessions/${live.sessionId}/stop`, { method: "POST", token: live.participantToken,
        key: current.operationKeys.stop, body: { reason: "participant_requested" } });
      persist({ ...current, livePresenceSession: { ...live, trackingStatus: "stopped" } });
      setNotice("位置送信を終了し、サーバーの最新位置を消去しました。");
    });
  }

  async function stopMemory() {
    if (!session || session.memoryDeleted) return;
    await run("メモリー参加を終了しています…", async () => {
      const current = withKey(session, "stop-memory");
      const state = await api<MemoryStopResult>(`/v1/memory-sessions/${current.memorySession.sessionId}/stop`, {
        method: "POST", token: current.memorySession.participantToken, key: current.operationKeys["stop-memory"],
      });
      persist({ ...current, memorySession: { ...current.memorySession, ...state } });
      setNotice("メモリー参加を終了しました。保存期限までは参加状態の確認とデータの削除ができます。");
    });
  }

  async function remove(kind: "memory" | "live" | "all") {
    if (!session) return;
    await run("参加データを削除しています…", async () => {
      let current = session;
      if (kind === "all" && !current.memoryDeleted && current.livePresenceSession) {
        const liveToken = current.livePresenceSession.participantToken;
        current = withKey(current, "delete-all");
        const result = await api<DeleteResult>(`/v1/experiences/${current.experienceId}`, {
          method: "DELETE", token: current.memorySession.participantToken,
          liveToken, key: current.operationKeys["delete-all"],
        });
        if (!result || result.memory !== "deleted" && result.memory !== "pending" ||
          result.live !== "deleted" && result.live !== "pending" ||
          typeof result.complete !== "boolean" ||
          result.complete && (result.memory !== "deleted" || result.live !== "deleted")) {
          throw new Error("削除結果を確認できませんでした。同じ操作を再度お試しください。");
        }
        if (!result.complete) {
          persist({ ...current, deleteResult: { memory: result.memory, live: result.live } });
          setConfirmDelete(null);
          setNotice("削除の一部が保留中です。両方の削除が完了するまで、同じ操作を再度実行してください。");
          return;
        }
        persist(null);
      } else {
        const target = kind === "all" ? current.memoryDeleted ? "live" : "memory" : kind;
        if (target === "memory" && current.memoryDeleted || target === "live" && !current.livePresenceSession) return;
        current = withKey(current, `delete-${target}`);
        const credential = target === "live" ? current.livePresenceSession! : current.memorySession;
        await api(`/v1/${target === "live" ? "live-presence" : "memory"}-sessions/${credential.sessionId}`, {
          method: "DELETE", token: credential.participantToken, key: current.operationKeys[`delete-${target}`],
        });
        const operationKeys = { ...current.operationKeys };
        delete operationKeys[`delete-${target}`];
        current = target === "live"
          ? { ...current, livePresenceSession: undefined, operationKeys }
          : { ...current, memoryDeleted: true, operationKeys };
        if (current.memoryDeleted && !current.livePresenceSession) persist(null);
        else persist(current);
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
          <p className="eyebrow"><span className="tiny-line" /> TRACE CAMPUS EXPERIENCE</p>
          <h1>あなたの参加が、<br />光になる。</h1>
          <p className="intro-copy">キャンパスで過ごすひとときを、<br />展示のなかでひとつの光に。<br />参加情報はいつでも削除できます。</p>
          <div className="route-art" aria-hidden="true">
            <svg viewBox="0 0 560 300" fill="none">
              <defs><pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#c9c9bc" /></pattern></defs>
              <rect width="560" height="300" fill="url(#grid)" />
              <circle cx="72" cy="220" r="12" fill="#e96f3c" fillOpacity=".08" /><circle cx="72" cy="220" r="4" fill="#e96f3c" />
              <circle cx="210" cy="98" r="20" fill="#e96f3c" fillOpacity=".08" /><circle cx="210" cy="98" r="5" fill="#e96f3c" />
              <circle cx="482" cy="75" r="24" fill="#e96f3c" fillOpacity=".08" /><circle cx="482" cy="75" r="12" fill="#e96f3c" fillOpacity=".15" /><circle cx="482" cy="75" r="5" fill="#e96f3c" />
              <text x="72" y="273" className="art-label">YOUR PARTICIPATION</text><text x="417" y="40" className="art-label">BECOMES LIGHT</text>
            </svg>
          </div>
          <div className="intro-foot"><span>あなたのペースで。</span><span>↗</span></div>
        </section>
        <section className="experience-panel" aria-label={session ? "参加状況" : "参加の準備"}>
          <div className="panel-top"><span className="eyebrow">{session ? "YOUR EXPERIENCE" : "BEFORE YOU BEGIN"}</span><span className="step-number">{session ? "02 / 02" : "01 / 02"}</span></div>
          <div aria-live="polite" aria-atomic="true">
            {error && <div className="message error" role="alert">{error}</div>}
            {notice && <div className="message success">{notice}</div>}
          </div>
          {!ready && <div className="loading"><span className="status-dot pulse" /> 参加状態を確認しています…</div>}
          {ready && !session && <div className="connection-state">
            <h2>新しい参加の準備中です</h2>
            <p>GPSを使わない参加方法と同意文を確認しています。この画面からの新規参加は、確認が済むまで受け付けません。</p>
            <p>以前の参加を停止・削除する場合は、参加したときと同じタブでこの画面を開いてください。</p>
            <Link href="/log" className="text-button">写真メモリーの試作を見る →</Link>
          </div>}
          {ready && session && <>
            {pendingDelete && <div className="message error" role="status">{session.deleteResult
              ? `削除は保留中です（メモリー: ${session.deleteResult.memory === "deleted" ? "削除済み" : "保留"}、位置情報: ${session.deleteResult.live === "deleted" ? "削除済み" : "保留"}）。同じ操作を再度実行してください。`
              : "前回の削除結果を確認できていません。同じ操作を再度実行してください。"}</div>}
            <h2>{memoryEnded ? "メモリー参加は終了しました" : session.memorySession.status === "arrived" ? "展示場に到着しました" : "あなたの参加を、展示へ。"}</h2>
            <p className="panel-description">位置情報を使わずに参加しています。</p>
            {session.livePresenceSession && <div className="presence-card">
              <div className="status-heading"><span className="status-dot" /><strong>{active ? "この画面からの位置送信は停止しています" : "位置送信は終了しています"}</strong></div>
              <p role="status">この画面は現在地を取得・送信しません。</p>
              {active && !pendingDelete && <div className="button-row"><button className="text-button" disabled={!!busy} onClick={stopLive}>この参加の位置送信を終了する</button></div>}
            </div>}
            {!session.memoryDeleted && <div className="session-dates"><span>メモリー参加期限 <strong>{date(session.memorySession.expiresAt)}</strong></span><span>メモリーデータ削除期限 <strong>{date(session.memorySession.deleteAfter)}</strong></span></div>}
            {!session.memoryDeleted && !memoryEnded && !pendingDelete && <button className="text-button" disabled={!!busy} onClick={stopMemory}>メモリー参加を終了する</button>}
            {session.livePresenceSession && <div className="session-dates"><span>位置参加期限 <strong>{date(session.livePresenceSession.expiresAt)}</strong></span><span>位置データ削除期限 <strong>{date(session.livePresenceSession.deleteAfter)}</strong></span></div>}
            <div className="manage-section"><h3>参加データの管理</h3><p>参加情報は個別に削除できます。</p><div className="manage-links">
              {!session.memoryDeleted && !session.operationKeys["delete-all"] && !session.operationKeys["delete-live"] && <button disabled={!!busy} onClick={() => setConfirmDelete("memory")}>メモリー参加情報を削除</button>}
              {session.livePresenceSession && !session.operationKeys["delete-all"] && !session.operationKeys["delete-memory"] && <button disabled={!!busy} onClick={() => setConfirmDelete("live")}>位置参加情報を削除</button>}
              {!session.operationKeys["delete-memory"] && !session.operationKeys["delete-live"] && <button disabled={!!busy} onClick={() => setConfirmDelete("all")}>すべて削除して終了</button>}
            </div></div>
            {confirmDelete && <div className="delete-confirm" role="group" aria-label="削除の確認"><strong>{confirmDelete === "all" ? "この参加のデータをすべて削除しますか？" : confirmDelete === "live" ? "位置情報の参加を削除しますか？" : "メモリー参加情報を削除しますか？"}</strong><p>{confirmDelete === "memory" && session.livePresenceSession ? "位置情報の参加は残ります。両方を消す場合は「すべて削除して終了」を選んでください。" : "削除したデータは元に戻せません。"}</p><div className="confirm-actions"><button className="danger-button" disabled={!!busy} onClick={() => remove(confirmDelete)}>{busy || "削除する"}</button><button className="secondary-button" disabled={!!busy} onClick={() => setConfirmDelete(null)}>キャンセル</button></div></div>}
            {!pendingDelete && <button className="text-button refresh-button" disabled={!!busy} onClick={() => run("状態を確認しています…", () => refresh(session))}>参加状態を更新 ↻</button>}
          </>}
          {config && <div className="contact"><span>お困りのときは</span><p>{config.contact}</p></div>}
        </section>
      </main>
      <footer className="site-footer"><span>TRACE — CAMPUS EXPERIENCE</span><span>A MOMENT. A TRACE.</span></footer>
    </div>
  );
}
