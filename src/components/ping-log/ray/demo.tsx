"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { reducedMotion } from "@/lib/ray/fx";

import { useLayer } from "../layer";
import { clock } from "../ui";
import { PrintPhoto, frameLabel, tearOne } from "./prints";
import { HomeMark, Icon, Phrases, ROOM, Screen, Sentences, SWAP, useField, useRay, useScroller } from "./stage";

/**
 * The demo of arriving at ShibaLab, after a day of nine sample photos:
 * reading the QR code at the door, the arrival while the room's screen
 * replays the day, the photo story, and the thanks. The arrival QR and the
 * replay stand in for the work's backend, which is not settled yet, so the
 * camera is a drawing and nothing is saved, sent or deleted.
 *
 * Reading the QR code turns the phone from paper to ink: the room is dark,
 * and everything from here on is read there. The phone shows no queue and no
 * symbol to look for: reading the code is what puts the visitor's own day on
 * the screen.
 */

/** The sample day: generated pictures of a festival, with no real people or places. */
const PHOTOS = ["10:08", "10:41", "11:26", "12:14", "13:32", "14:20", "15:47", "16:05", "16:52"].map((time, index) => ({
  time,
  src: `/log/demo/${String(index + 1).padStart(2, "0")}.jpg`,
  ratio: 2 / 3,
}));
const FIRST = PHOTOS[0].time;
const LAST = PHOTOS[PHOTOS.length - 1].time;
const REPLAY_MS = 12_000;

function minutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

type Step = "scan" | "arrived" | "story" | "thanks";

/** onHome: the TRACE mark, which leads to the participant's home even when the demo was opened from the developer screen. */
export function DemoFlow({ closeLabel, inert, onClose, onHome }: { closeLabel: string; inert: boolean; onClose: () => void; onHome: () => void }) {
  const { go, toast } = useRay();
  const [step, setStep] = useState<Step>("scan");
  const close = useLayer("#demo", onClose);
  const leave = useCallback(() => void go(close), [go, close]);
  const home = useCallback(
    () =>
      void go(() => {
        close();
        onHome();
      }),
    [go, close, onHome],
  );
  const say = useCallback((text: string) => toast(text), [toast]);

  if (step === "scan") return <Scan inert={inert} onCancel={leave} onRead={() => setStep("arrived")} />;
  if (step === "arrived") return <Arrived inert={inert} onLeave={leave} onHome={home} onStory={() => void go(() => setStep("story"))} />;
  if (step === "story") return <Story inert={inert} onLeave={leave} say={say} onFinish={() => void go(() => setStep("thanks"))} />;
  return <Thanks inert={inert} closeLabel={closeLabel} say={say} onClose={leave} />;
}

function DemoClose({ onLeave }: { onLeave: () => void }) {
  return (
    <button type="button" className="icon-btn" aria-label="デモを終える" onClick={onLeave}>
      <Icon name="close" />
    </button>
  );
}

/* ------------------------------------------------------------------- scan */

/** A QR code's modules: random, with the three finder squares. */
const QR = (() => {
  const n = 25;
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const m = Array.from({ length: n }, () => Array.from({ length: n }, () => (random() > 0.52 ? 1 : 0)));
  const finder = (ox: number, oy: number) => {
    for (let y = -1; y < 8; y += 1) {
      for (let x = -1; x < 8; x += 1) {
        const X = ox + x;
        const Y = oy + y;
        if (X < 0 || Y < 0 || X >= n || Y >= n) continue;
        const edge = x === -1 || y === -1 || x === 7 || y === 7;
        const ring = x === 0 || y === 0 || x === 6 || y === 6;
        const core = x >= 2 && x <= 4 && y >= 2 && y <= 4;
        m[Y][X] = edge ? 0 : ring || core ? 1 : 0;
      }
    }
  };
  finder(0, 0);
  finder(n - 7, 0);
  finder(0, n - 7);
  return { n, m };
})();

/** The camera's view of the poster at the door, swaying a little as a hand would. Returns where the code is. */
function drawCamera(context: CanvasRenderingContext2D, width: number, height: number, t: number) {
  const sx = Math.sin(t * 1.3) * 5 + Math.sin(t * 2.9) * 2;
  const sy = Math.cos(t * 1.1) * 4;
  context.save();
  context.fillStyle = "#6d7073";
  context.fillRect(0, 0, width, height);
  context.translate(sx, sy);
  const wall = context.createLinearGradient(0, 0, width, height);
  wall.addColorStop(0, "#a6a9ab");
  wall.addColorStop(0.55, "#7d8083");
  wall.addColorStop(1, "#4b4e51");
  context.fillStyle = wall;
  context.fillRect(-20, -20, width + 40, height + 40);
  context.fillStyle = "#2c2e30";
  context.fillRect(-20, height * 0.84, width + 40, height);
  context.fillStyle = "#3a3c3f";
  context.fillRect(width * 0.79, height * 0.06, width * 0.3, height * 0.8);
  context.fillStyle = "#1f2123";
  context.fillRect(width * 0.8, height * 0.08, width * 0.28, height * 0.76);
  const pw = width * 0.5;
  const ph = pw * 1.36;
  const px = (width - pw) / 2 - 8;
  const py = height * 0.19;
  context.fillStyle = "#f1f1ed";
  context.fillRect(px, py, pw, ph);
  const q = pw * 0.74;
  const qx = px + (pw - q) / 2;
  const qy = py + pw * 0.13;
  const cell = q / QR.n;
  context.fillStyle = "#121314";
  for (let y = 0; y < QR.n; y += 1) {
    for (let x = 0; x < QR.n; x += 1) {
      if (QR.m[y][x]) context.fillRect(qx + x * cell, qy + y * cell, cell + 0.4, cell + 0.4);
    }
  }
  context.font = `800 ${Math.round(pw * 0.13)}px Geist, Arial, sans-serif`;
  context.textAlign = "center";
  context.fillText("ShibaLab", px + pw / 2, qy + q + pw * 0.2);
  context.font = `500 ${Math.round(pw * 0.065)}px monospace`;
  context.fillText("TRACE / 301", px + pw / 2, qy + q + pw * 0.31);
  context.restore();
  return { x0: qx + sx, y0: qy + sy, x1: qx + q + sx, y1: qy + q + sy };
}

const LOCK_AT = 1.6;
const ARRIVE_AFTER_MS = 900;

function Scan({ inert, onCancel, onRead }: { inert: boolean; onCancel: () => void; onRead: () => void }) {
  const { field, fx } = useRay();
  const windowRef = useRef<HTMLDivElement>(null);
  const trackers = useRef<(HTMLDivElement | null)[]>([]);
  const [locked, setLocked] = useState(false);
  useField("day", { scene: 2, splitOn: 0, invert: 0, imgBg: 1, gain: 1.15, bias: -0.04 }, "scan");

  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  }, [onRead]);

  useEffect(() => {
    const box = windowRef.current;
    if (!field || !fx || !box) return;
    const camera = document.createElement("canvas");
    camera.width = 300;
    camera.height = 400;
    const context = camera.getContext("2d");
    if (!context) return;
    let done = false;
    let lockedAt = 0;
    let timer: number | undefined;
    const t0 = performance.now();
    const still = reducedMotion();

    const uv = (): [number, number, number, number] => {
      const rect = box.getBoundingClientRect();
      const canvas = field.canvas.getBoundingClientRect();
      return [(rect.left - canvas.left) / canvas.width, 1 - (rect.bottom - canvas.top) / canvas.height, (rect.right - canvas.left) / canvas.width, 1 - (rect.top - canvas.top) / canvas.height];
    };
    drawCamera(context, camera.width, camera.height, 0);
    field.image(camera, uv(), true);
    const onResize = () => field.image(camera, uv(), true);
    window.addEventListener("resize", onResize);

    const arrive = async () => {
      if (done) return;
      field.burst(1);
      await fx.tear(420, 1);
      done = true;
      field.follow(null);
      field.stopImage();
      await fx.split(SWAP, 1250);
      // The screen is all negative now: the room's ink takes over for real, and the overlay goes.
      flushSync(() => onReadRef.current());
      fx.clear();
    };

    field.follow(() => {
      if (done) return;
      const t = (performance.now() - t0) / 1000;
      const code = drawCamera(context, camera.width, camera.height, still ? 0 : t);
      field.image(camera, null, true);
      if (t < LOCK_AT) return;
      if (!lockedAt) {
        lockedAt = t;
        setLocked(true);
        timer = window.setTimeout(() => void arrive(), ARRIVE_AFTER_MS);
      }
      // The four corners, from the camera's pixels to the window's.
      const rect = box.getBoundingClientRect();
      const [cx, cy] = field.u.cover;
      const corners = [
        [code.x0, code.y0],
        [code.x1, code.y0],
        [code.x0, code.y1],
        [code.x1, code.y1],
      ];
      trackers.current.forEach((tracker, index) => {
        if (!tracker) return;
        const x = ((corners[index][0] / camera.width - 0.5) / cx + 0.5) * rect.width;
        const y = ((corners[index][1] / camera.height - 0.5) / cy + 0.5) * rect.height;
        tracker.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
        const label = tracker.lastElementChild;
        if (label) label.textContent = `x: ${String(Math.round(x)).padStart(4, "0")} y: ${String(Math.round(y)).padStart(4, "0")}`;
      });
    });

    return () => {
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      field.follow(null);
      field.stopImage();
    };
  }, [field, fx]);

  return (
    <Screen className="scan" inert={inert}>
      <div className="topbar">
        <span>
          <button type="button" className="link" onClick={onCancel}>
            <Icon name="close" />
            やめる
          </button>
        </span>
        <span className="mono">Scan</span>
        <span className="mono mono--dim">Demo</span>
      </div>
      <h1 className="h2 scan__head">
        <Phrases text="入口の QR コードを、枠に入れてください" />
      </h1>
      <div ref={windowRef} className="scan__window">
        <div className="scan__target" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="scan__cross" aria-hidden="true" />
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            ref={(element) => {
              trackers.current[index] = element;
            }}
            className={`trk${locked ? " is-on" : ""}`}
            aria-hidden="true"
          >
            <i />
            <span>x: 0000 y: 0000</span>
          </div>
        ))}
      </div>
      <div className="scan__status">
        <p className="h3" role="status">
          {locked ? "読み取りました" : "読み取っています…"}
        </p>
        <span className="mono">{locked ? "Lock" : "Searching"}</span>
      </div>
      <p className="small">
        <Sentences text="デモでは、カメラの代わりに用意した映像を使い、読み取りも自動で進みます。" />
      </p>
    </Screen>
  );
}

/* ---------------------------------------------------------------- arrived */

function Arrived({ inert, onLeave, onHome, onStory }: { inert: boolean; onLeave: () => void; onHome: () => void; onStory: () => void }) {
  const { field } = useRay();
  const stageRef = useRef<HTMLDivElement>(null);
  const [arrivedAt] = useState(() => clock(Date.now()));
  const [progress, setProgress] = useState(0);
  const played = progress >= 1;
  // The beam leaves the phone upward, toward the room's screen.
  useField("room", { scene: 1, splitOn: 0, invert: 0, beam: 1, grow: 1, flow: 16, pool: 1, poolAt: 0, poolR: [0.085, 0.02] });

  // The beam starts low in the stage, on the right, and runs straight up past the top edge. It follows the page.
  const scroller = useScroller();
  useEffect(() => {
    const stage = stageRef.current;
    if (!field || !stage) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      const canvas = field.canvas.getBoundingClientRect();
      if (!canvas.height) return;
      const x = (rect.left + rect.width * 0.8 - canvas.left) / canvas.width;
      const y = 1 - (rect.top + rect.height * 0.8 - canvas.top) / canvas.height;
      field.set({ beamA: [x, y], beamB: [x, 1.3] });
    };
    update();
    const scroll = scroller?.current;
    scroll?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroll?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [field, scroller]);

  // A point of light comes on, then the beam shoots up out of the top of the screen.
  useEffect(() => {
    if (!field || reducedMotion()) return;
    let alive = true;
    field.set({ grow: 0, pool: 0 });
    void field.to({ pool: 1 }, 420, "out").then(() => {
      if (!alive) return;
      field.burst(0.45);
      return field.to({ grow: 1 }, 700, "in");
    });
    return () => {
      alive = false;
    };
  }, [field]);

  // The replay runs on the room's screen; the phone shows how far along it is.
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const value = Math.min(1, (now - t0) / REPLAY_MS);
      setProgress(value);
      if (value < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // The beam has done its job: it goes out, and the field stops redrawing.
  useEffect(() => {
    if (played) void field?.to({ beam: 0, pool: 0.35 }, 900, "inOut");
  }, [played, field]);

  return (
    <Screen inert={inert}>
      <header className="mast">
        <div className="mast__mark">
          <HomeMark onHome={onHome} />
          <span className="mono">ShibaLab 301</span>
        </div>
        <DemoClose onLeave={onLeave} />
      </header>
      <div ref={stageRef} className="arrived__stage" aria-hidden="true" />
      <p className="mono">
        Arrived <span className="latin">{arrivedAt}</span>
      </p>
      <h1 className="h1">
        <Phrases text="ShibaLab に到着しました" />
      </h1>
      <section className="play" aria-labelledby="ray-play">
        <p className="mono">{played ? "■ Played" : <><span className="blink">▶</span> Playback</>}</p>
        <h2 className="h2" id="ray-play">
          {played ? "再生が終わりました" : "スクリーンを見てください"}
        </h2>
        <p className="body">
          <Sentences text={`あなたの歩んできた軌跡を、スクリーンで再生しています。${FIRST} から ${LAST} までを、${REPLAY_MS / 1000}秒に縮めています。`} />
        </p>
        <div className="play__line" role="progressbar" aria-label="再生" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <div className="play__run" style={{ width: `${(progress * 100).toFixed(2)}%` }} />
        </div>
        <div className="play__ends mono">
          <span>{FIRST}</span>
          <span>{LAST}</span>
        </div>
      </section>
      <p className="float-note small">撮影のリマインダーは終わりました。</p>
      {played && (
        <button type="button" className="btn" style={{ marginTop: 18 }} onClick={onStory}>
          写真ストーリーを見る
        </button>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ story */

function Story({ inert, onLeave, onFinish, say }: { inert: boolean; onLeave: () => void; onFinish: () => void; say: (text: string) => void }) {
  useField("room", ROOM);
  const listRef = useRef<HTMLDivElement>(null);

  // Each photo tears once as it comes into view. Its colours move only for that moment.
  useEffect(() => {
    const list = listRef.current;
    if (!list || reducedMotion()) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          void tearOne(entry.target.querySelector("[data-print]"), 340, 0.9);
        });
      },
      { root: list.closest(".screen"), threshold: 0.45 },
    );
    // The photos load first; a tear on an empty frame would show nothing.
    const timer = window.setTimeout(() => list.querySelectorAll(".story__photo").forEach((photo) => observer.observe(photo)), 300);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <Screen inert={inert}>
      <div className="topbar">
        <span className="mono">Story</span>
        <span className="mono">
          {FIRST} → {LAST}
        </span>
        <span>
          <DemoClose onLeave={onLeave} />
        </span>
      </div>
      <h1 className="h1">
        <Phrases text="あなたの写真ストーリー" />
      </h1>
      <div ref={listRef}>
        {PHOTOS.map((photo, index) => (
          <div key={photo.time}>
            {index > 0 && (
              <div className="story__gap">
                <span className="small">{minutes(photo.time) - minutes(PHOTOS[index - 1].time)}分後</span>
              </div>
            )}
            <article className="story__item" aria-label={`${photo.time} の写真`}>
              <div className="story__time">
                <span className="t">{photo.time}</span>
                <span className="mono">{frameLabel(index + 1)}</span>
              </div>
              <div className="story__photo" style={{ ["--ratio" as string]: photo.ratio }}>
                <PrintPhoto source={{ src: photo.src }} alt={`${photo.time} の写真`} />
              </div>
              <div className="story__del">
                <button type="button" className="link" aria-label={`${photo.time} の写真を削除`} onClick={() => say("デモのため、削除はしません。")}>
                  削除
                </button>
              </div>
            </article>
          </div>
        ))}
      </div>
      <div className="btns" style={{ marginTop: 26 }}>
        <button type="button" className="btn btn--line" onClick={() => say("デモのため、保存はしません。")}>
          <Icon name="download" />
          端末に保存
        </button>
        <button type="button" className="btn" onClick={onFinish}>
          おわる
        </button>
      </div>
    </Screen>
  );
}

/* ----------------------------------------------------------------- thanks */

function Thanks({ inert, closeLabel, onClose, say }: { inert: boolean; closeLabel: string; onClose: () => void; say: (text: string) => void }) {
  useField("room", ROOM);
  return (
    <Screen inert={inert}>
      <p className="mono thanks__tag">Thank you</p>
      <h1 className="h1">
        <Phrases text="参加ありがとうございました" />
      </h1>
      <section className="bracket" style={{ marginTop: 22 }}>
        <h2 className="h3">保存期間</h2>
        <p className="body">
          <Sentences text="写真と軌跡のデータは、展示が終わるまで保存し、その後削除します。具体的な期間は準備中です。" />
        </p>
      </section>
      <section className="bracket" style={{ marginTop: 14 }}>
        <h2 className="h3">データの削除</h2>
        <p className="body">
          <Sentences text="期間の途中でも削除できます。写真だけ削除すると、軌跡のデータは残ります。" />
        </p>
        <div className="btns btns--2" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn--line" onClick={() => say("デモのため、削除はしません。")}>
            写真だけ削除
          </button>
          <button type="button" className="btn btn--danger" onClick={() => say("デモのため、削除はしません。")}>
            すべて削除
          </button>
        </div>
      </section>
      <button type="button" className="btn" style={{ marginTop: 22 }} onClick={onClose}>
        {closeLabel}
      </button>
      <p className="endlog mono mono--dim">
        TRACE · ShibaLab 301 · Ray
        <br />
        54th Shibaura Festival
        <br />
        End of log
      </p>
    </Screen>
  );
}
