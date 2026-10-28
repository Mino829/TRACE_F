"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Player } from "@/lib/display/player";
import type { RoutePath } from "@/lib/display/route-path";

import { ArrivalQr } from "./arrival-qr";
import { GoogleSignIn } from "./google-sign-in";
import { useRendererLink, type DisplayLink } from "./use-renderer-link";
import type { ArrivalToPlay, LinkState, ReplayResult } from "@/lib/display/renderer-link";

/**
 * The booth projector (issue #24), in ShibaLab's RAY theme like the phone
 * screens of /log. Three screens:
 *
 * - top: the arrival QR on paper. Visitors read it with TRACE on their phone.
 * - playback: ink. A drone following the line (left, large, with a small map
 *   of the whole campus in its corner) and a first-person walk in colour
 *   (right) replay the visitor's walk.
 * - arrived: a short card, then back to the top.
 *
 * Arrivals: with TRACE_B configured (NEXT_PUBLIC_DISPLAY_API_URL and
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID, use-renderer-link.ts) an operator signs in with
 * Google on the top screen, and the booth takes TRACE_B's arrivals one at a
 * time as the primary renderer: the visitor's route (pathNodeIds), then the
 * arrived card, then the next visitor or the QR. A visitor without a route
 * (no photos) gets the card alone. The top screen keeps test
 * buttons (Space also plays). A test keeps going, one walk after another,
 * until 終了する (or Esc). Query: ?speed=1.5 (pace; 1 walks at WALK_SPEED),
 * ?duration=30 (fit every walk into that many seconds instead), ?fps=1
 * (frames per second in the corner, to check the booth PC keeps up).
 */
type Screen = "loading" | "top" | "playback" | "arrived";

const ARRIVED_SECONDS = 4;
type TestRoute = "sample" | "random";

export function DisplayClient() {
  const mapRef = useRef<HTMLCanvasElement>(null);
  const droneRef = useRef<HTMLCanvasElement>(null);
  const walkRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState<number | null>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const routesRef = useRef<Record<TestRoute, () => RoutePath> | null>(null);
  /** Builds an arrival's walk from its route's graph node ids; null when there is no route to walk. */
  const arrivalRouteRef = useRef<((pathNodeIds: string[]) => RoutePath | null) | null>(null);
  /** The arrival walking, settled when its walk ends or TRACE_B takes it back. */
  const liveRef = useRef<{ resolve: (result: ReplayResult) => void } | null>(null);
  /** True while the booth shows a visitor's arrival (walk and card) rather than a test. */
  const [live, setLive] = useState(false);
  /** True from play until the walk ends or the top screen takes over. */
  const playingRef = useRef(false);
  /** The test running, if any: after each walk the next one starts until 終了する. */
  const testRef = useRef<TestRoute | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [status, setStatus] = useState({ stop: "", place: "", progress: 0 });
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
      const params = new URLSearchParams(window.location.search);
      const speed = Number(params.get("speed")) || 1;
      const duration = Number(params.get("duration")) || undefined;
      const showFps = params.get("fps") === "1";
      // Test walks favour indoors and the escalators, like most visitors.
      routesRef.current = {
        sample: () => buildRoutePath(graph.routeThrough(graph.SAMPLE_STOPS, graph.INDOOR_FIRST)),
        random: () => buildRoutePath(graph.routeThrough(graph.randomIndoorStops(), graph.INDOOR_FIRST)),
      };
      arrivalRouteRef.current = (pathNodeIds) => (pathNodeIds.length >= 2 ? buildRoutePath(graph.routeThrough(pathNodeIds, graph.METRES)) : null);
      const player = await createPlayer({
        overview: mapRef.current!,
        follow: droneRef.current!,
        walk: walkRef.current!,
        mapLabels: labelsRef.current!,
        speed,
        duration,
        onProgress: ({ s, length, stop, place, done, fps }) => {
          setStatus({ stop, place, progress: s / length });
          if (showFps) setFps(fps);
          if (done && playingRef.current) {
            playingRef.current = false;
            setArrivedAt(clock(new Date()).slice(0, 5));
            setScreen("arrived");
            // A visitor's walk is complete here; TRACE_B is told, and the card then holds the booth.
            liveRef.current?.resolve("completed");
            liveRef.current = null;
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

  const play = useCallback((which: TestRoute) => {
    const player = playerRef.current;
    const routes = routesRef.current;
    if (!player || !routes) return;
    testRef.current = which;
    setStatus({ stop: "", place: "", progress: 0 });
    playingRef.current = true;
    player.play(routes[which]());
    setScreen("playback");
  }, []);

  const backToTop = useCallback(() => {
    playingRef.current = false;
    testRef.current = null;
    setLive(false);
    // A visitor's walk stopped by hand (終了する, Esc) is reported as failed rather than left hanging.
    liveRef.current?.resolve("failed");
    liveRef.current = null;
    playerRef.current?.stop();
    setScreen("top");
  }, []);

  /** One arrival from TRACE_B: its walk fitted into the replay time TRACE_B gives, over a test walk if one is running. */
  const replayArrival = useCallback(
    (arrival: ArrivalToPlay, signal: AbortSignal) =>
      new Promise<ReplayResult>((resolve) => {
        const player = playerRef.current;
        const build = arrivalRouteRef.current;
        if (!player || !build) return resolve("failed");
        let path: RoutePath | null;
        try {
          path = build(arrival.pathNodeIds);
        } catch (problem) {
          console.error(`display: arrival ${arrival.arrivalId} has a route the campus graph cannot walk`, problem);
          return resolve("failed");
        }
        testRef.current = null;
        setLive(true);
        if (!path) {
          // No route to walk (no photos, or none on this graph version): the arrived card alone.
          playingRef.current = false;
          setArrivedAt(clock(new Date()).slice(0, 5));
          setScreen("arrived");
          return resolve("completed");
        }
        liveRef.current = { resolve };
        setStatus({ stop: "", place: "", progress: 0 });
        playingRef.current = true;
        player.play(path, arrival.durationSeconds ?? undefined);
        setScreen("playback");
        // TRACE_B skipped it, or the lease went: back to the top without reporting.
        signal.addEventListener(
          "abort",
          () => {
            if (liveRef.current?.resolve !== resolve) return;
            liveRef.current = null;
            backToTop();
            resolve("failed");
          },
          { once: true },
        );
      }),
    [backToTop],
  );
  // After a visitor's card, the link starts the next visitor or hands the booth back to the QR.
  const link = useRendererLink(screen !== "loading", replayArrival, backToTop);

  // The arrived card stays a few seconds; a test then plays its next walk. A visitor's card is timed by the link.
  useEffect(() => {
    if (screen !== "arrived" || live) return;
    const id = window.setTimeout(() => {
      if (testRef.current) play(testRef.current);
      else backToTop();
    }, ARRIVED_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [screen, live, play, backToTop]);

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
          <canvas ref={droneRef} className="dsp-canvas" aria-label="光の先頭を追いかける視点" />
          <p className="dsp-view__label">DRONE</p>
          <section className="dsp-minimap">
            <canvas ref={mapRef} className="dsp-canvas" aria-label="キャンパス全体と軌跡" />
            <div ref={labelsRef} className="dsp-labels" aria-hidden="true" />
            <p className="dsp-minimap__label">MAP</p>
          </section>
        </section>
        <section className="dsp-view">
          <canvas ref={walkRef} className="dsp-canvas" aria-label="一人称の視点" />
          <p className="dsp-view__label dsp-view__label--sky">WALK</p>
        </section>
        <header className="dsp-mast dsp-mast--room">
          <p className="dsp-mark">
            <span className="wordmark">TRACE</span>
            <span className="dsp-mono">SHIBALAB 301</span>
          </p>
          <div className="dsp-tests">
            <span className="dsp-mono">{live ? "ARRIVAL" : "TEST · 繰り返し再生中"}</span>
            <button type="button" className="dsp-test" onClick={backToTop}>
              ■ 終了する <span className="dsp-mono">ESC</span>
            </button>
          </div>
        </header>
        <div className="dsp-play">
          <p className="dsp-mono dsp-play__kicker">
            PLAYBACK<span className="dsp-play__place">{status.place}</span>
          </p>
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
              {link && <LinkBadge link={link} />}
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
      {fps !== null && screen !== "top" && <p className="dsp-fps">{fps} FPS</p>}
    </div>
  );
}

const LINK_LABEL: Record<LinkState, string> = {
  login: "LINK · 運営の Google ログインが必要です",
  connecting: "LINK · 接続中",
  standby: "LINK · 待機（別の画面が再生担当）",
  primary: "LINK · 再生担当",
  rejected: "LINK · つなげません",
};

/** Whether the booth is taking arrivals from TRACE_B, and the operator's sign-in when it is needed. */
function LinkBadge({ link }: { link: DisplayLink }) {
  return (
    <>
      <span className="dsp-mono dsp-link" data-state={link.state} role="status">
        {LINK_LABEL[link.state]}
        {link.detail ? `：${link.detail}` : ""}
      </span>
      {link.state === "login" && <GoogleSignIn clientId={link.googleClientId} onToken={link.signIn} />}
    </>
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
