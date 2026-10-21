"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Player } from "@/lib/display/player";
import type { RoutePath } from "@/lib/display/route-path";
import { createSound, type Cue, type SoundEngine } from "@/lib/display/sound";

import { ArrivalQr } from "./arrival-qr";

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
 * Prototype: nothing arrives from TRACE_B yet, so the top screen has test
 * buttons (Space also plays). A test keeps going, one walk after another,
 * until 終了する (or Esc). Query: ?speed=1.5 (pace; 1 walks at WALK_SPEED),
 * ?duration=30 (fit every walk into that many seconds instead), ?fps=1
 * (frames per second in the corner, to check the booth PC keeps up).
 *
 * Sound (issue #27, src/lib/display/sound.ts): music while waiting and while
 * replaying, a cue as a walk starts and one at ShibaLab. The browser needs one
 * click before it makes sound, so 音を出す shows until then (the test buttons
 * count too). ?volume=0.6 sets the level, ?mute=1 silences it, ?sound=1 shows
 * which sounds are the real files and which are still placeholders.
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
  /** True from play until the walk ends or the top screen takes over. */
  const playingRef = useRef(false);
  /** The test running, if any: after each walk the next one starts until 終了する. */
  const testRef = useRef<TestRoute | null>(null);
  const [screen, setScreen] = useState<Screen>("loading");
  const [status, setStatus] = useState({ stop: "", place: "", progress: 0 });
  const [arrivedAt, setArrivedAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const [sound, setSound] = useState<{ unlocked: boolean; sources: Record<Cue, string> } | null>(null);
  const [showSources, setShowSources] = useState(false);

  // Sound: made on mount, told which screen is up, unlocked by the first click or key.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const volume = params.has("volume") ? Number(params.get("volume")) : 1;
    const engine = createSound({ volume: Number.isFinite(volume) ? volume : 1, muted: params.get("mute") === "1" });
    soundRef.current = engine;
    const sync = () => setSound({ unlocked: engine.unlocked, sources: { ...engine.sources } });
    const off = engine.subscribe(sync);
    const first = window.setTimeout(() => {
      sync();
      setShowSources(params.get("sound") === "1");
    }, 0);
    return () => {
      window.clearTimeout(first);
      off();
      engine.dispose();
      soundRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (screen !== "loading") soundRef.current?.scene(screen);
  }, [screen]);

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
    void soundRef.current?.unlock();
    testRef.current = which;
    setStatus({ stop: "", place: "", progress: 0 });
    playingRef.current = true;
    player.play(routes[which]());
    setScreen("playback");
  }, []);

  const backToTop = useCallback(() => {
    playingRef.current = false;
    testRef.current = null;
    playerRef.current?.stop();
    setScreen("top");
  }, []);

  // The arrived card stays a few seconds; a test then plays its next walk,
  // a real arrival hands the booth back to the top screen.
  useEffect(() => {
    if (screen !== "arrived") return;
    const id = window.setTimeout(() => {
      if (testRef.current) play(testRef.current);
      else backToTop();
    }, ARRIVED_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [screen, play, backToTop]);

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
            <span className="dsp-mono">TEST · 繰り返し再生中</span>
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

      {sound && !sound.unlocked && (
        <button type="button" className="dsp-test dsp-sound" onClick={() => void soundRef.current?.unlock()}>
          ♪ 音を出す
        </button>
      )}
      {sound && showSources && (
        <p className="dsp-mono dsp-sound-sources">
          SOUND {Object.entries(sound.sources).map(([cue, src]) => `${cue}:${src}`).join(" / ")}
        </p>
      )}
      <Hud screen={screen} />
      {fps !== null && screen !== "top" && <p className="dsp-fps">{fps} FPS</p>}
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
