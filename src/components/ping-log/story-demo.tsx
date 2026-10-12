"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { MAX_PHOTOS } from "@/lib/ping-log/record";

import { ArrivalWindow } from "./arrival-window";
import { Confetti } from "./clear-screen";
import { DemoMap, STOPS, STORY_MINUTES, storyClock } from "./demo-map";
import { useLayer } from "./layer";
import { MemoryWindow, type MemoryPhoto } from "./memory-window";
import { PixelIcon } from "./pixel-icon";
import { DEMO_PHOTO_LABEL, PixelPhoto } from "./pixel-photo";
import { PixelSprite } from "./pixel-sprite";
import { ReminderSwitch } from "./reminder-switch";
import { Phrases, PxButton, PxLink, Sentences, Window } from "./ui";

/**
 * The demo of arriving at ShibaLab: what a participant would see after four
 * photos, in five screens, in the participant screens' own look. The striped
 * bar at the top marks it as a demo and can step to the next screen from
 * anywhere. Nothing here is saved or sent; the arrival QR and the replay stand
 * in for the work's backend, which is not settled yet.
 *
 * People come to ShibaLab whenever they like. At the door they read the QR
 * code with the button on home, and the screen in the room replays their day
 * at once: the one at the head of the line is the one who reads it, so the
 * phone shows no queue. Nor does it give them a symbol to look for on the
 * screen: reading the code is what puts their own day there.
 */

const SCREENS = 5;
const SCAN_MS = 1500;
const REPLAY_MS = 12_000;
const NOTICE_MS = 2600;

type Props = {
  onClose: () => void;
  /** 2 when the participant's own home opened it with its QR button: their home was screen 1. */
  start?: number;
  /** The photo limit home shows. */
  maxPhotos?: number;
};

export function StoryDemo({ onClose, start = 1, maxPhotos = MAX_PHOTOS }: Props) {
  const [screen, setScreen] = useState(start);
  const [notice, setNotice] = useState("");
  const close = useLayer("#demo", onClose);
  const scrollRef = useRef<HTMLDivElement>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  const next = useCallback(() => setScreen((value) => Math.min(SCREENS, value + 1)), []);

  /** What a button would have done, said instead of doing it. */
  const notify = useCallback((text: string) => {
    window.clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = window.setTimeout(() => setNotice(""), NOTICE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  // Each screen starts at its top, with its heading read out.
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    scrollRef.current?.querySelector<HTMLElement>("[data-demo-title]")?.focus();
  }, [screen]);

  return (
    <div className="fixed inset-0 z-30 flex flex-col" role="dialog" aria-modal="true" aria-label="会場到着のデモ">
      <DemoBar screen={screen} onNext={next} onClose={close} />
      <div ref={scrollRef} className={`relative min-h-0 flex-1 overflow-y-auto ${screen === 2 ? "px-stage" : ""}`}>
        {screen === 1 && <Home max={maxPhotos} onScan={next} notify={notify} />}
        {screen === 2 && <Scan onDone={next} />}
        {screen === 3 && <Arrived onDone={next} />}
        {screen === 4 && <Story onFinish={next} notify={notify} />}
        {screen === 5 && <Thanks onClose={close} notify={notify} />}
      </div>
      <p className="pointer-events-none fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-10 mx-auto max-w-md" role="status">
        {notice && <span className="px-note px-note--float px-drop">{notice}</span>}
      </p>
    </div>
  );
}

/** The bar that marks the demo: hazard stripes, the position, and the shortcut to the next screen. */
function DemoBar({ screen, onNext, onClose }: { screen: number; onNext: () => void; onClose: () => void }) {
  return (
    <div className="px-demobar">
      <div className="mx-auto max-w-md space-y-1 px-3 pt-2">
        <p className="flex items-start gap-2 text-[13px] leading-snug">
          <span className="px-chip px-chip--alert mt-0.5" aria-label={`デモ ${SCREENS}画面のうち${screen}画面目`}>
            DEMO {screen}/{SCREENS}
          </span>
          <span>
            <Sentences text="写真を4枚撮ったあとを想定したデモ画面です。ShibaLab に着いたときの画面の流れを、「次の画面へ」で順に体験できます。" />
          </span>
        </p>
        <div className="flex items-center justify-between gap-1">
          <PxButton variant="secondary" size="sm" onClick={onClose}>デモを終える</PxButton>
          <PxButton size="sm" onClick={onNext} disabled={screen >= SCREENS}>
            次の画面へ<span aria-hidden="true"> &#9654;</span>
          </PxButton>
        </div>
      </div>
    </div>
  );
}

/** A screen over the sky and the city, laid out as the participant screens are. */
function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-md space-y-7 px-4 pt-6 pb-[calc(72px+env(safe-area-inset-bottom))]">{children}</div>;
}

function Title({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {/* On a dark ground of its own, so it reads on the bright sky too. */}
      <p className="px-label inline-block bg-(--px-k) px-1.5">{label}</p>
      <h2 data-demo-title tabIndex={-1} className="mt-1 text-[24px] leading-snug outline-none">
        {children}
      </h2>
    </div>
  );
}

const PHOTOS = STOPS.filter((stop) => stop.photo);

/** The demo's four photos for the memory window, newest first. */
const MEMORY: MemoryPhoto[] = [...PHOTOS].reverse().map((stop) => ({
  id: stop.id,
  time: storyClock(stop.minutes),
  ratio: 4 / 3,
  image: stop.photo ? <PixelPhoto name={stop.photo} className="px-polaroid__photo" label={`${storyClock(stop.minutes)} の写真（${DEMO_PHOTO_LABEL[stop.photo]}）`} /> : null,
  unsent: false,
}));

/** 1. Home, four photos in, the same as the participant's own; its QR button at the foot opens the way in. */
function Home({ max, onScan, notify }: { max: number; onScan: () => void; notify: (text: string) => void }) {
  return (
    <Page>
      <p className="px-on-scene flex min-h-11 items-center gap-2" aria-label="TRACE">
        <PixelSprite name="pin" scale={2} />
        <span className="px-pixel px-outlined text-[14px]" aria-hidden="true">TRACE</span>
      </p>
      <h2 data-demo-title tabIndex={-1} className="px-sr">ホーム</h2>

      <MemoryWindow photos={MEMORY} max={max} />

      <div className="px-on-scene">
        <PxButton block size="lg" icon="camera" onClick={() => notify("デモのため、撮影はしません。")}>写真を撮る</PxButton>
      </div>

      <ReminderSwitch
        on={false}
        support="supported"
        busy={false}
        nextAt={null}
        onChange={async () => {
          notify("デモのため、リマインダーは切り替えません。");
          return null;
        }}
      />

      <ArrivalWindow onScan={onScan} />
    </Page>
  );
}

/** A made-up QR code: the three corner squares, the timing lines, and noise. */
const QR_RUNS = (() => {
  const size = 21;
  const finder = (x: number, y: number) => (x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12);
  const dark = (x: number, y: number): boolean => {
    if (finder(x, y)) {
      const fx = x > 12 ? x - 14 : x;
      const fy = y > 12 ? y - 14 : y;
      if (fx > 6 || fy > 6) return false;
      return fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4);
    }
    if (y === 6 || x === 6) return (x + y) % 2 === 0;
    return false;
  };
  let seed = 20261010;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const runs: { x: number; y: number; width: number }[] = [];
  for (let y = 0; y < size; y += 1) {
    let start = -1;
    for (let x = 0; x <= size; x += 1) {
      const on = x < size && (finder(x, y) || y === 6 || x === 6 ? dark(x, y) : random() > 0.52);
      if (on && start < 0) start = x;
      if (!on && start >= 0) {
        runs.push({ x: start, y, width: x - start });
        start = -1;
      }
    }
  }
  return runs;
})();

function PixelQr() {
  return (
    <svg viewBox="0 0 25 25" shapeRendering="crispEdges" aria-hidden="true">
      <rect width={25} height={25} fill="#fff7e6" />
      {QR_RUNS.map((run) => <rect key={`${run.x}-${run.y}`} x={run.x + 2} y={run.y + 2} width={run.width} height={1} fill="#0b0d1f" />)}
    </svg>
  );
}

/** 2. Reading the QR code at the entrance; it reads itself and moves on. */
function Scan({ onDone }: { onDone: () => void }) {
  const [read, setRead] = useState(false);

  useEffect(() => {
    const reading = window.setTimeout(() => setRead(true), SCAN_MS);
    const leaving = window.setTimeout(onDone, SCAN_MS + 900);
    return () => {
      window.clearTimeout(reading);
      window.clearTimeout(leaving);
    };
  }, [onDone]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-4 pt-6 pb-10 text-center">
      <Title label="Scan">
        <Phrases text={"入口の QR コードを、枠に入れてください"} />
      </Title>
      <div className="px-scan mt-7" data-state={read ? "done" : "reading"}>
        <PixelQr />
        {read ? (
          <span className="px-scan__ok px-drop" aria-hidden="true">
            <PixelIcon name="check" size={48} />
          </span>
        ) : (
          <i className="px-scan__line" aria-hidden="true" />
        )}
      </div>
      <p className="mt-6 text-[18px]" role="status">
        {read ? "読み取りました" : "読み取っています…"}
      </p>
    </div>
  );
}

/** The replay's progress in 24 steps, so the bar grows in blocks like a game's gauge. */
const PROGRESS_STEPS = 24;

/**
 * 3. Arrived: the replay starts on the room's screen at once. The phone only
 * points to the screen; the trail itself is shown there.
 */
function Arrived({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    let leaving: number | undefined;
    const started = performance.now();
    const tick = (time: number) => {
      const value = Math.min(1, (time - started) / REPLAY_MS);
      setProgress(Math.floor(value * PROGRESS_STEPS) / PROGRESS_STEPS);
      if (value < 1) frame = window.requestAnimationFrame(tick);
      else leaving = window.setTimeout(onDone, 1500);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(leaving);
    };
  }, [onDone]);

  const done = progress >= 1;

  return (
    <>
      <Confetti />
      <Page>
        <Title label="Arrived" className="px-on-scene">
          <span className="px-outlined">ShibaLab に到着しました</span>
        </Title>

        <Window tone="alert" title={done ? "再生が終わりました" : <><span className="px-blink">&#9654;</span> 再生中</>} as="section">
          <p className="text-[20px]">スクリーンを見てください</p>
          <p className="mt-1 text-[14px] leading-relaxed text-(--px-ink-2)">
            <Sentences text={`あなたの歩んできた軌跡を、スクリーンで再生しています。${storyClock(0)} から ${storyClock(STORY_MINUTES)} までを、${REPLAY_MS / 1000}秒に縮めています。`} />
          </p>
          <div
            className="px-progress mt-3"
            role="progressbar"
            aria-label="再生"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <i style={{ width: `${progress * 100}%` }} />
          </div>
        </Window>

        <p className="px-note px-note--float">撮影のリマインダーは終わりました。</p>
      </Page>
    </>
  );
}

/** 4. The photo story: the whole trail, then the photos in order with the time between them. */
function Story({ onFinish, notify }: { onFinish: () => void; notify: (text: string) => void }) {
  return (
    <Page>
      <Title label="Story" className="px-on-scene">
        <span className="px-outlined">あなたの写真ストーリー</span>
      </Title>

      <Window title="あなたの歩んできた軌跡" as="section">
        <div className="px-mapframe">
          <DemoMap className="block h-auto w-full" />
        </div>
        <p className="mt-2 text-[13px] text-(--px-ink-2)">
          <Sentences text="地図はイメージです。写真と写真のあいだの道のりは推定です。" />
        </p>
      </Window>

      <Window title="写真と時刻" as="section">
        <ol className="px-timeline">
          {STOPS.map((stop, index) => {
            const after = STOPS[index + 1];
            return (
              <li key={stop.id}>
                <div className="px-timeline__stop">
                  {stop.photo ? (
                    <PixelPhoto name={stop.photo} className="px-timeline__thumb" label={`${DEMO_PHOTO_LABEL[stop.photo]}の写真`} />
                  ) : (
                    <span className="px-timeline__thumb grid place-items-center">
                      <PixelSprite name="pin" scale={3} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="px-pixel text-[12px] text-(--px-yellow)">{storyClock(stop.minutes)}</p>
                    <p className="text-[16px] leading-snug">{stop.label}</p>
                  </div>
                  {stop.photo && (
                    <PxLink className="text-[14px]!" onClick={() => notify("デモのため、削除はしません。")} aria-label={`${stop.label}の写真を削除`}>
                      削除
                    </PxLink>
                  )}
                </div>
                {after && (
                  <p className="px-timeline__leg text-[14px] text-(--px-ink-2)">
                    <span className="px-pixel mr-1 text-[12px] text-(--px-ink)">{after.minutes - stop.minutes}</span>分後
                  </p>
                )}
              </li>
            );
          })}
        </ol>
        <div className="mt-3 border-t-3 border-(--px-navy-3) pt-3">
          <PxButton variant="secondary" block icon="download" onClick={() => notify("デモのため、保存はしません。")}>端末に保存</PxButton>
        </div>
      </Window>

      <div className="px-on-scene">
        <PxButton block size="lg" icon="arrow" onClick={onFinish}>おわる</PxButton>
      </div>
    </Page>
  );
}

/** 5. The end: thanks, how long the data stays, and deleting it now. */
function Thanks({ onClose, notify }: { onClose: () => void; notify: (text: string) => void }) {
  return (
    <Page>
      <div className="flex flex-col items-center gap-3 text-center">
        <Title label="Thank you" className="px-on-scene">
          <span className="px-outlined">
            <Phrases text="参加ありがとうございました" />
          </span>
        </Title>
      </div>

      <Window title="保存期間" as="section">
        <p className="text-[15px] leading-relaxed">
          <Sentences text="写真と軌跡のデータは、展示が終わるまで保存し、その後削除します。具体的な期間は準備中です。" />
        </p>
      </Window>

      <Window title="データの削除" as="section">
        <p className="text-[15px] leading-relaxed">
          <Sentences text="期間の途中でも削除できます。写真だけ削除すると、軌跡のデータは残ります。" />
        </p>
        <div className="mt-3 grid grid-cols-2 gap-1">
          <PxButton variant="secondary" block size="sm" icon="trash" onClick={() => notify("デモのため、削除はしません。")}>写真だけ削除</PxButton>
          <PxButton variant="secondary" block size="sm" icon="trash" onClick={() => notify("デモのため、削除はしません。")}>すべて削除</PxButton>
        </div>
      </Window>

      <div className="px-on-scene">
        <PxButton block size="lg" onClick={onClose}>デモを終える</PxButton>
      </div>
    </Page>
  );
}
