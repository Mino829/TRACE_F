"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Player } from "@/lib/display/player";
import type { RoutePath } from "@/lib/display/route-path";

import { ArrivalQr } from "./arrival-qr";

/**
 * The booth projector (issue #24), in ShibaLab's RAY theme like the phone
 * screens of /log. Three screens:
 *
 * - top: the arrival QR on paper. Visitors read it with TRACE on their phone.
 * - playback: ink. The campus map on the left and a drone following the line
 *   on the right replay the visitor's walk.
 * - arrived: a short card, then back to the top.
 *
 * Prototype: nothing arrives from TRACE_B yet, so the top screen has test
 * buttons (Space also plays). Query: ?duration=20 (seconds per walk).
 */
type Screen = "loading" | "top" | "playback" | "arrived";

const ARRIVED_SECONDS = 5;

export function DisplayClient() {
  const mapRef = useRef<HTMLCanvasElement>(null);
  const droneRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const routesRef = useRef<{ sample: () => RoutePath; random: () => RoutePath } | null>(null);
  /** True from play until the walk ends or the top screen takes over. */
  const playingRef = useRef(false);
  const [screen, setScreen] = useState<Screen>("loading");
  const [status, setStatus] = useState({ stop: "", progress: 0 });
  const [arrivedAt, setArrivedAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    (async () => {
      // three.js loads only on this route.
      const [{ createPlayer }, graph, { buildRoutePath }] = await Promise.all([
        import("@/lib/display/player"),
        import("@/lib/display/campus-graph"),
        import("@/lib/display/route-path"),
      ]);
      const duration = Number(new URLSearchParams(window.location.search).get("duration")) || 20;
      routesRef.current = {
        sample: () => buildRoutePath(graph.routeThrough(graph.SAMPLE_STOPS)),
        random: () => buildRoutePath(graph.routeThrough(randomStops(graph))),
      };
      const player = await createPlayer({
        overview: mapRef.current!,
        follow: droneRef.current!,
        duration,
        onProgress: ({ s, length, stop, done }) => {
          setStatus({ stop, progress: s / length });
          if (done && playingRef.current) {
            playingRef.current = false;
            setArrivedAt(clock(new Date()).slice(0, 5));
            setScreen("arrived");
          }
        },
      });
      if (disposed) {
        player.dispose();
        return;
      }
      playerRef.current = player;
      setScreen("top");
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const play = useCallback((which: "sample" | "random") => {
    const player = playerRef.current;
    const routes = routesRef.current;
    if (!player || !routes) return;
    setStatus({ stop: "", progress: 0 });
    playingRef.current = true;
    player.play(routes[which]());
    setScreen("playback");
  }, []);

  const backToTop = useCallback(() => {
    playingRef.current = false;
    playerRef.current?.stop();
    setScreen("top");
  }, []);

  // The arrived card stays a few seconds, then the booth is ready for the next visitor.
  useEffect(() => {
    if (screen !== "arrived") return;
    const id = window.setTimeout(backToTop, ARRIVED_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [screen, backToTop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && screen === "top") {
        e.preventDefault();
        play("sample");
      } else if (e.code === "Escape" && screen !== "top") {
        backToTop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, play, backToTop]);

  return (
    <div className="dsp" data-screen={screen}>
      {/* Playback: always mounted so the campus is loaded before the first visitor. */}
      <div className="dsp-stage" aria-hidden={screen === "top"}>
        <section className="dsp-view">
          <canvas ref={mapRef} className="dsp-canvas" aria-label="キャンパス全体と軌跡" />
          <p className="dsp-view__label">MAP</p>
        </section>
        <section className="dsp-view">
          <canvas ref={droneRef} className="dsp-canvas" aria-label="光の先頭を追いかける視点" />
          <p className="dsp-view__label">DRONE</p>
        </section>
        <header className="dsp-mast dsp-mast--room">
          <p className="dsp-mark">
            <span className="wordmark">TRACE</span>
            <span className="dsp-mono">SHIBALAB 301</span>
          </p>
          <button type="button" className="dsp-test" onClick={backToTop}>
            トップに戻る <span className="dsp-mono">TEST · ESC</span>
          </button>
        </header>
        <div className="dsp-play">
          <p className="dsp-mono dsp-play__kicker">PLAYBACK</p>
          <p className="dsp-play__stop">{status.stop || "…"}</p>
          <div className="dsp-play__bar">
            <span style={{ width: `${status.progress * 100}%` }} />
          </div>
        </div>
      </div>

      {screen === "arrived" && (
        <div className="dsp-arrived">
          <p className="dsp-mono">ARRIVED {arrivedAt}</p>
          <p className="dsp-arrived__title">ShibaLab に到着しました</p>
          <p className="dsp-arrived__lead">あなたの歩いてきた一日の軌跡でした。</p>
        </div>
      )}

      {(screen === "top" || screen === "loading") && (
        <div className="dsp-top">
          <p className="dsp-ghost" aria-hidden="true">RAY</p>
          <header className="dsp-mast">
            <p className="dsp-mono">
              54TH SHIBAURA FESTIVAL
              <br />
              SHIBALAB 301 / RAY
            </p>
            <div className="dsp-tests">
              <span className="dsp-mono">TEST</span>
              <button type="button" className="dsp-test" disabled={screen !== "top"} onClick={() => play("sample")}>
                ▶ テスト再生 <span className="dsp-mono">SPACE</span>
              </button>
              <button type="button" className="dsp-test" disabled={screen !== "top"} onClick={() => play("random")}>
                ▶ ランダムな道
              </button>
            </div>
          </header>
          <div className="dsp-top__body">
            <div className="dsp-top__lead">
              <h1 className="dsp-title">TRACE</h1>
              <p className="dsp-catch">あなたの歩いた一日を、光でたどる。</p>
              <p className="dsp-text">
                スマホの TRACE で「ShibaLab へ」を開いて、
                <br />
                この QR コードを読み取ってください。
                <br />
                あなたの歩いてきた軌跡が、このスクリーンに映ります。
              </p>
              <ol className="dsp-steps">
                <li>
                  <span className="dsp-mono">1</span>TRACE を開く
                </li>
                <li>
                  <span className="dsp-mono">2</span>QR を読み取る
                </li>
                <li>
                  <span className="dsp-mono">3</span>スクリーンを見る
                </li>
              </ol>
              {error ? (
                <p className="dsp-error">3D を読み込めませんでした：{error}</p>
              ) : screen === "loading" ? (
                <p className="dsp-mono dsp-loading">LOADING CAMPUS…</p>
              ) : null}
            </div>
            <ArrivalQr />
          </div>
        </div>
      )}

      <Hud screen={screen} />
    </div>
  );
}

/** Corner brackets and the bottom readout, as on the phone. */
function Hud({ screen }: { screen: Screen }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);
  return (
    <div className="dsp-hud" aria-hidden="true">
      <i className="dsp-hud__c dsp-hud__c--tl" />
      <i className="dsp-hud__c dsp-hud__c--tr" />
      <i className="dsp-hud__c dsp-hud__c--bl" />
      <i className="dsp-hud__c dsp-hud__c--br" />
      <p className="dsp-hud__read">
        <span>{screen === "top" || screen === "loading" ? "TRACE / FES.54 10.31-11.01 / ASYNC BOOTH" : "TRACE / SHIBALAB 301"}</span>
        <span>{now ? clock(now) : ""}</span>
      </p>
    </div>
  );
}

function clock(d: Date): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/** A test walk: two or three outdoor checkpoints in random order, always ending at ShibaLab. */
function randomStops(graph: typeof import("@/lib/display/campus-graph")): string[] {
  const outdoor = [...graph.NODES.values()]
    .filter((n) => n.role === "checkpoint" && n.floor === "屋外")
    .map((n) => n.id);
  const picked: string[] = [];
  while (picked.length < 3) {
    const id = outdoor[Math.floor(Math.random() * outdoor.length)];
    if (!picked.includes(id)) picked.push(id);
  }
  return [...picked, "shibalab"];
}
