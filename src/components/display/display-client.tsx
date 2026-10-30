"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Player } from "@/lib/display/player";
import { createRelay, type Point, type Relay } from "@/lib/display/relay";
import type { RoutePath } from "@/lib/display/route-path";
import { createSound, type Cue, type SoundEngine } from "@/lib/display/sound";

import { ArrivalQr } from "./arrival-qr";
import { GoogleSignIn } from "./google-sign-in";
import { useRendererLink, type DisplayLink } from "./use-renderer-link";
import { useOperatorSession } from "./use-operator-session";
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
 * The visitor's phone and this screen pass one light between them
 * (src/lib/display/relay.ts): before each walk the light the phone sent comes
 * up from the foot of the screen and lands where the line begins (the intro),
 * and when the walk is over it pours out of the foot of the screen, back to the
 * phone. Test walks show it too.
 *
 * Arrivals: with TRACE_B configured (NEXT_PUBLIC_DISPLAY_API_URL and
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID, use-renderer-link.ts) an operator signs in with
 * Google on the top screen, and the booth takes TRACE_B's arrivals one at a
 * time as the primary renderer: the visitor's route (pathNodeIds), then the
 * arrived card, then the next visitor or the QR. A visitor without a route
 * (no photos) gets the card alone. A long walk is fitted into about a minute
 * (REPLAY_SECONDS); a short one keeps its own pace and ends sooner.
 *
 * Visitors see the projector, so the controls for the team stay off it: the
 * link and operator status, the test buttons and 終了する show only with ?dev.
 * Without it the top screen shows nothing but the Google button, and that only
 * while the booth still needs an operator to sign in. With ?dev the top screen
 * keeps test buttons (Space also plays). A test keeps going, one walk after
 * another, until 終了する (or Esc). Query: ?duration=30 (fit every walk into
 * that many seconds instead; ?duration=0 walks at the natural pace),
 * ?speed=1.5 (that pace; 1 walks at WALK_SPEED), ?fps=1
 * (frames per second in the corner, to check the booth PC keeps up),
 * ?stops=hq-11f,hq-4f-bridge,shibalab (the sample test walks through these
 * graph nodes in order, choosing each leg by metres the way TRACE_B does).
 *
 * Sound (issue #27, src/lib/display/sound.ts): music while waiting and while
 * replaying, a cue as a walk starts and one at ShibaLab. The browser needs one
 * click before it makes sound, so 音を出す shows until then (the test buttons
 * count too). ?volume=0.6 sets the level, ?mute=1 silences it, ?sound=1 shows
 * which sounds are the real files and which are still placeholders.
 */
type Screen = "loading" | "top" | "intro" | "playback" | "arrived";

const ARRIVED_SECONDS = 4;
/**
 * The longest a walk plays: a longer one goes faster to fit, a shorter one
 * keeps WALK_SPEED (route-path.ts buildTimeline). TRACE_B suggests 15 seconds
 * (replayDurationSeconds); the booth gives a long walk about a minute instead.
 */
const REPLAY_SECONDS = 60;
type TestRoute = "sample" | "random";

/** Where the head of the line stands: the middle of the drone view, which follows it. */
function middleOf(element: Element | null): Point {
  if (!element) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function DisplayClient() {
  const mapRef = useRef<HTMLCanvasElement>(null);
  const droneRef = useRef<HTMLCanvasElement>(null);
  const walkRef = useRef<HTMLCanvasElement>(null);
  const [fps, setFps] = useState<number | null>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const relayCanvasRef = useRef<HTMLCanvasElement>(null);
  const relayRef = useRef<Relay | null>(null);
  /** The light coming in for the walk about to start; aborted when the booth goes back to its QR first. */
  const introRef = useRef<AbortController | null>(null);
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
  const screenRef = useRef<Screen>("loading");
  /** What the room darkens over while the light comes in: the QR, or the card of the walk before. */
  const [under, setUnder] = useState<Screen>("top");
  const [status, setStatus] = useState({ stop: "", place: "", progress: 0 });
  const [arrivedAt, setArrivedAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const soundRef = useRef<SoundEngine | null>(null);
  const [sound, setSound] = useState<{ unlocked: boolean; sources: Record<Cue, string> } | null>(null);
  const [showSources, setShowSources] = useState(false);
  /** ?dev: the team's controls (status, tests, 終了する) on screen. */
  const [dev, setDev] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDev(new URLSearchParams(window.location.search).has("dev")), 0);
    return () => window.clearTimeout(id);
  }, []);

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

  // The light coming in is the moment the QR code was read: its cue, and the replay's music.
  useEffect(() => {
    screenRef.current = screen;
    if (screen !== "loading") soundRef.current?.scene(screen === "intro" ? "playback" : screen);
  }, [screen]);

  useEffect(() => {
    const relay = createRelay(relayCanvasRef.current!);
    relayRef.current = relay;
    return () => {
      relay.dispose();
      relayRef.current = null;
    };
  }, []);

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
      const duration = params.has("duration") ? Number(params.get("duration")) || undefined : REPLAY_SECONDS;
      const showFps = params.get("fps") === "1";
      const stops = params.has("stops") ? graph.parseStops(params.get("stops") ?? "") : null;
      // Test walks favour indoors and the escalators, like most visitors; ?stops walks like an arrival.
      routesRef.current = {
        sample: () => buildRoutePath(stops ? graph.routeThrough(stops, graph.METRES) : graph.routeThrough(graph.SAMPLE_STOPS, graph.INDOOR_FIRST)),
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
            // The light leaves the end of the line and pours out toward the visitor's phone.
            relayRef.current?.release(() => middleOf(droneRef.current));
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

  /** The light from the visitor's phone comes in and lands at `to`; then `start` runs the walk (or the card) from there. */
  const comeIn = useCallback((to: () => Point, start: () => void) => {
    introRef.current?.abort();
    const relay = relayRef.current;
    if (!relay) return start();
    const intro = new AbortController();
    introRef.current = intro;
    if (screenRef.current !== "intro") setUnder(screenRef.current);
    setScreen("intro");
    void relay.arrive(to, intro.signal).then((landed) => {
      if (!landed || intro.signal.aborted) return;
      introRef.current = null;
      start();
    });
  }, []);

  const play = useCallback(
    (which: TestRoute) => {
      const player = playerRef.current;
      const routes = routesRef.current;
      if (!player || !routes) return;
      void soundRef.current?.unlock();
      testRef.current = which;
      setStatus({ stop: "", place: "", progress: 0 });
      const path = routes[which]();
      comeIn(
        () => middleOf(droneRef.current),
        () => {
          playingRef.current = true;
          player.play(path);
          setScreen("playback");
        },
      );
    },
    [comeIn],
  );

  const backToTop = useCallback(() => {
    playingRef.current = false;
    testRef.current = null;
    introRef.current?.abort();
    introRef.current = null;
    relayRef.current?.clear();
    setLive(false);
    // A visitor's walk stopped by hand (終了する, Esc) is reported as failed rather than left hanging.
    liveRef.current?.resolve("failed");
    liveRef.current = null;
    playerRef.current?.stop();
    setScreen("top");
  }, []);

  /**
   * One arrival from TRACE_B, over a test walk if one is running: the light
   * comes in, then its walk, fitted into REPLAY_SECONDS like any other.
   */
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
        playingRef.current = false;
        setLive(true);
        setStatus({ stop: "", place: "", progress: 0 });
        liveRef.current = { resolve };
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
        if (!path) {
          // No route to walk (no photos, or none on this graph version): the light lands in the middle, then the arrived card alone.
          const middle = () => middleOf(null);
          comeIn(middle, () => {
            if (liveRef.current?.resolve !== resolve) return;
            liveRef.current = null;
            setArrivedAt(clock(new Date()).slice(0, 5));
            setScreen("arrived");
            relayRef.current?.release(middle);
            resolve("completed");
          });
          return;
        }
        const route = path;
        comeIn(
          () => middleOf(droneRef.current),
          () => {
            if (liveRef.current?.resolve !== resolve) return;
            playingRef.current = true;
            player.play(route);
            setScreen("playback");
          },
        );
      }),
    [backToTop, comeIn],
  );
  // After a visitor's card, the link starts the next visitor or hands the booth back to the QR.
  const link = useRendererLink(screen !== "loading", replayArrival, backToTop);
  const operator = useOperatorSession();
  const googleClientId = link?.googleClientId ?? process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
  const signIn = (idToken: string) => {
    link?.signIn(idToken);
    void operator.session?.signIn(idToken);
  };
  const signOut = async (all: boolean) => {
    const revoked = await operator.session?.logout(all);
    if (revoked) {
      link?.signOut();
      window.google?.accounts.id.disableAutoSelect?.();
    }
  };

  // The arrived card stays a few seconds; a test then plays its next walk. A visitor's card is timed by the link.
  useEffect(() => {
    if (screen !== "arrived" || live) return;
    const id = window.setTimeout(() => {
      if (testRef.current) play(testRef.current);
      else backToTop();
    }, ARRIVED_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [screen, live, play, backToTop]);

  // Bound as the screen commits, so a key pressed as soon as the top shows is not taken by the last screen's handler.
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && screen === "top" && dev) {
        e.preventDefault();
        play("sample");
      } else if (e.code === "Escape" && screen !== "top") {
        backToTop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, dev, play, backToTop]);

  return (
    <div className="dsp" data-screen={screen}>
      {/* Playback: always mounted so the campus is loaded before the first visitor. */}
      <div className="dsp-stage" aria-hidden={screen === "top" || screen === "intro"}>
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
            <span className="dsp-mono keep-case">ShibaLab 301</span>
          </p>
          {dev && (
            <div className="dsp-tests">
              <span className="dsp-mono">{live ? "ARRIVAL" : "TEST · 繰り返し再生中"}</span>
              <button type="button" className="dsp-test" onClick={backToTop}>
                ■ 終了する <span className="dsp-mono">ESC</span>
              </button>
            </div>
          )}
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

      {(screen === "arrived" || (screen === "intro" && under === "arrived")) && (
        <div className="dsp-arrived">
          <p className="dsp-mono">ARRIVED {arrivedAt}</p>
          <p className="dsp-arrived__title">ShibaLab に到着しました</p>
          <p className="dsp-arrived__lead">あなたの歩いてきた一日の軌跡でした。</p>
        </div>
      )}

      {/* The top stays under the light coming in until it lands. */}
      {(screen === "top" || screen === "loading" || (screen === "intro" && (under === "top" || under === "loading"))) && (
        <div className="dsp-top">
          <p className="dsp-ghost" aria-hidden="true">RAY</p>
          <header className="dsp-mast">
            <p className="dsp-mono">
              54TH SHIBAURA FESTIVAL
              <br />
              <span className="keep-case">ShibaLab</span> 301 / RAY
            </p>
            <div className="dsp-tests">
              {dev && link && <LinkBadge link={link} />}
              {dev && operator.session && (
                <>
                  <span className="dsp-mono dsp-link" data-operator-state={operator.state} role="status">
                    運営 · {operator.state === "ready" ? "到着 QR 発行可" : operator.state === "authorizing" ? "認証中" : operator.state === "revoking" ? "失効中" : operator.state === "error" ? "認証・通信エラー" : "Google ログインが必要です"}
                    {operator.detail ? `：${operator.detail}` : ""}
                  </span>
                  {operator.state === "error" && <button type="button" className="dsp-test" onClick={() => void operator.session?.retry()}>運営認証を再試行</button>}
                  {operator.state !== "login" && <button type="button" className="dsp-test" disabled={operator.state === "revoking"} onClick={() => void signOut(false)}>ログアウト・現在の運営資格を失効</button>}
                  {operator.state !== "login" && <button type="button" className="dsp-test" disabled={operator.state === "revoking"} onClick={() => void signOut(true)}>自分の全運営資格を失効</button>}
                </>
              )}
              {googleClientId && (link?.state === "login" || (operator.session && (operator.state === "login" || operator.state === "error"))) && <GoogleSignIn clientId={googleClientId} onToken={signIn} />}
              {dev && (
                <>
                  <span className="dsp-mono">TEST</span>
                  <button type="button" className="dsp-test" disabled={screen !== "top"} onClick={() => play("sample")}>
                    ▶ テスト再生 <span className="dsp-mono">SPACE</span>
                  </button>
                  <button type="button" className="dsp-test" disabled={screen !== "top"} onClick={() => play("random")}>
                    ▶ ランダムな道
                  </button>
                </>
              )}
            </div>
          </header>
          <div className="dsp-top__body">
            <div className="dsp-top__lead">
              <h1 className="dsp-title">TRACE</h1>
              <p className="dsp-catch">あなたの歩いた一日を、光でたどる。</p>
              <p className="dsp-text">
                スマホの TRACE で「QR コードを読み取る」を押して、
                <br />
                この QR コードを枠に入れてください。
                <br />
                あなたの歩いてきた軌跡が、このスクリーンに映ります。
              </p>
              <ol className="dsp-steps">
                <li>
                  <span className="dsp-mono">1</span>TRACE を開く
                </li>
                <li>
                  <span className="dsp-mono">2</span>QR コードを読み取る
                </li>
                <li>
                  <span className="dsp-mono">3</span>スクリーンを見る
                </li>
              </ol>
              {error ? (
                <p className="dsp-error">展示を始められませんでした：{error}</p>
              ) : screen === "loading" ? (
                <p className="dsp-mono dsp-loading">LOADING CAMPUS…</p>
              ) : null}
            </div>
            <ArrivalQr key={operator.state} session={operator.session} authorized={operator.state === "ready"} dev={dev} />
          </div>
        </div>
      )}

      <canvas ref={relayCanvasRef} className="dsp-relay" aria-hidden="true" />

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

const LINK_LABEL: Record<LinkState, string> = {
  login: "LINK · 展示用の Google ログインが必要です",
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
        <span>{screen === "top" || screen === "loading" ? "TRACE / FES.54 10.31-11.01 / ASYNC BOOTH" : "TRACE / ShibaLab 301"}</span>
        <span>{now ? clock(now) : ""}</span>
      </p>
    </div>
  );
}

function clock(d: Date): string {
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}
