"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { DemoMap, LEGS, LineSample, STOPS, STORY_MINUTES, storyClock, type Certainty } from "./demo-map";
import { useLayer } from "./layer";
import { PixelIcon, type PixelIconName } from "./pixel-icon";
import { DEMO_PHOTO_LABEL, PixelPhoto } from "./pixel-photo";
import { PixelSprite } from "./pixel-sprite";
import { Phrases, PxButton, PxLink, Sentences, Window } from "./ui";

/**
 * The demo of arriving at the venue, opened from the developer screen: what a
 * participant would see after four photos, in six screens, in the participant
 * screens' own look. The striped bar at the top marks it as a demo and can
 * step to the next screen from anywhere. Nothing here is saved or sent; the
 * arrival QR, the queue and the replay stand in for the work's backend, which
 * is not settled yet.
 */

const SCREENS = 6;
const SCAN_MS = 1500;
const QUEUE_SECONDS = 5;
const REPLAY_MS = 12_000;
const NOTICE_MS = 2600;

export function StoryDemo({ onClose }: { onClose: () => void }) {
  const [screen, setScreen] = useState(1);
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

  const dark = screen === 2 || screen === 4;

  return (
    <div className="fixed inset-0 z-30 flex flex-col" role="dialog" aria-modal="true" aria-label="会場到着のデモ">
      <DemoBar screen={screen} onNext={next} onClose={close} />
      <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto ${dark ? "px-stage" : ""}`}>
        {screen === 1 && <Joined onScan={next} />}
        {screen === 2 && <Scan onDone={next} />}
        {screen === 3 && <Waiting onDone={next} />}
        {screen === 4 && <Replay onDone={next} />}
        {screen === 5 && <Story onFinish={next} notify={notify} />}
        {screen === 6 && <Thanks onClose={close} notify={notify} />}
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
            <Sentences text="写真を4枚撮ったあとを想定したデモ画面です。会場に到着したときの画面の流れを、「次の画面へ」で順に体験できます。" />
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

/** 1. Joined, four photos in: the way to the venue's QR code. */
function Joined({ onScan }: { onScan: () => void }) {
  return (
    <Page>
      <p className="px-on-scene flex items-center gap-2" aria-label="TRACE">
        <PixelSprite name="pin" scale={2} />
        <span className="px-pixel px-outlined text-[14px]" aria-hidden="true">TRACE</span>
      </p>

      <Window tone="alert" title={<><span className="px-blink">!</span> つぎは ShibaLab へ</>} as="section">
        <h2 data-demo-title tabIndex={-1} className="text-[17px] outline-none">
          <Phrases text={"ShibaLab（教室棟301）に着いたら、入口の QR\u00a0コードを読み取ってください。"} />
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-(--px-ink-2)">続きは会場で見られます。</p>
        <div className="mt-3">
          <PxButton block icon="qr" onClick={onScan}>到着の QR を読み取る</PxButton>
        </div>
      </Window>

      <Window title="きょうのメモリー" as="section">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px]">撮った写真</p>
          <p className="text-[15px] text-(--px-yellow)" aria-label="12枚のうち4枚">
            <span className="px-pixel mr-1 text-[13px]">4 / 12</span>枚
          </p>
        </div>
        <ul className="px-thumbs mt-3">
          {PHOTOS.map((stop) => (
            <li key={stop.id}>
              {stop.photo && <PixelPhoto name={stop.photo} label={`${storyClock(stop.minutes)} の写真（${DEMO_PHOTO_LABEL[stop.photo]}）`} />}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-baseline justify-between gap-3 border-t-3 border-(--px-navy-3) pt-3">
          <p className="text-[15px]">きょうのコイン</p>
          <p className="px-pixel text-[14px] text-(--px-yellow)" aria-label="4枚">&times;4</p>
        </div>
        <div className="px-coins mt-3" aria-hidden="true">
          {PHOTOS.map((stop) => <PixelSprite key={stop.id} name="coin" scale={2} />)}
        </div>
      </Window>
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
        <Phrases text={"入口の QR\u00a0コードを、枠に入れてください"} />
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

const QUEUE: { icon: PixelIconName; name: string; colour: string }[] = [
  { icon: "diamond", name: "水色のひし形", colour: "text-(--px-cyan)" },
  { icon: "heart", name: "赤いハート", colour: "text-(--px-red)" },
  { icon: "star", name: "黄色い星", colour: "text-(--px-yellow)" },
];

/** 3. Arrived: the participant's symbol, and the queue for the screen counting down. */
function Waiting({ onDone }: { onDone: () => void }) {
  const [left, setLeft] = useState(QUEUE_SECONDS);

  useEffect(() => {
    const timer = left > 0 ? window.setTimeout(() => setLeft(left - 1), 1000) : window.setTimeout(onDone, 700);
    return () => window.clearTimeout(timer);
  }, [left, onDone]);

  const ahead = left >= 4 ? 2 : left >= 2 ? 1 : 0;
  const queue = QUEUE.slice(2 - ahead);

  return (
    <Page>
      <Title label="Arrived" className="px-on-scene">
        <span className="px-outlined">ShibaLab に到着しました</span>
      </Title>

      <Window title="あなたの記号" as="section">
        <div className="flex items-center gap-4">
          <PixelIcon name="star" size={84} className="px-symbol px-bob text-(--px-yellow)" label="黄色い星" />
          <div className="min-w-0">
            <p className="text-[20px]">黄色い星</p>
            <p className="mt-1 text-[14px] leading-relaxed text-(--px-ink-2)">
              <Sentences text="スクリーンにも同じ記号が出ます。名前や写真は出ません。" />
            </p>
          </div>
        </div>
      </Window>

      <Window title="再生の順番" as="section">
        <p className="text-[20px]" role="status">
          {ahead > 0 ? (
            <>
              あなたの番まで、あと<span className="px-pixel mx-1.5 text-[18px] text-(--px-yellow)">{ahead}</span>人です
            </>
          ) : (
            "あなたの番です"
          )}
        </p>
        <ol className="px-queue mt-3" aria-label="再生を待っている人の記号">
          {queue.map((item, index) => (
            <li key={item.icon} data-you={item.icon === "star" || undefined}>
              <PixelIcon name={item.icon} size={36} className={`px-symbol ${item.colour}`} label={item.name} />
              <span className="text-[13px]">{index === 0 ? "再生中" : item.icon === "star" ? "あなた" : "つぎ"}</span>
            </li>
          ))}
        </ol>
      </Window>

      <p className="px-note px-note--float">撮影のリマインダーは終わりました。</p>
    </Page>
  );
}

/** 4. The replay on the big screen, mirrored small: the day's route drawn in twelve seconds. */
function Replay({ onDone }: { onDone: () => void }) {
  const [minutes, setMinutes] = useState(0);

  useEffect(() => {
    let frame = 0;
    let leaving: number | undefined;
    const started = performance.now();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - started) / REPLAY_MS);
      const at = progress * STORY_MINUTES;
      // Half-minute steps: the walker moves in small hops, like a game sprite.
      // With reduced motion each leg appears whole as its stop is reached.
      setMinutes(still ? (STOPS.findLast((stop) => stop.minutes <= at)?.minutes ?? 0) : Math.floor(at * 2) / 2);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
      else leaving = window.setTimeout(onDone, 1200);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(leaving);
    };
  }, [onDone]);

  const last = STOPS.findLast((stop) => stop.minutes <= minutes) ?? STOPS[0];

  return (
    <div className="mx-auto w-full max-w-md space-y-5 px-4 pt-6 pb-10">
      <Title label="Now playing">スクリーンを見てください</Title>
      <p className="-mt-2 text-[15px] text-(--px-ink-2)">
        <Phrases text="あなたの道のりを、スクリーンで再生しています。" />
      </p>
      <div className="flex items-end justify-between gap-3">
        <p className="px-digits" aria-hidden="true">{storyClock(minutes)}</p>
        <p className="pb-1 text-right text-[15px] leading-snug" aria-live="polite">
          <span className="px-pixel block text-[11px] text-(--px-yellow)">{storyClock(last.minutes)}</span>
          {last.label}
        </p>
      </div>
      <div className="px-mapframe">
        <DemoMap minutes={minutes} ripples className="block h-auto w-full" />
      </div>
      <p className="px-note">
        <Phrases text="10:12 から 11:58 までを、12秒に縮めて再生しています。" />
      </p>
    </div>
  );
}

/** `short` is the legend's word, under its note that the line shows the certainty. */
const CERTAINTY: Record<Certainty, { label: string; short: string; line: string }> = {
  high: { label: "確かさ 高", short: "高", line: "実線" },
  mid: { label: "確かさ 中", short: "中", line: "破線" },
  low: { label: "確かさ 低", short: "低", line: "点線" },
  unknown: { label: "位置がわからない区間", short: "位置がわからない区間", line: "灰色の点線" },
};

/** 5. The photo story: the whole route, then the photos and the walks between them in order. */
function Story({ onFinish, notify }: { onFinish: () => void; notify: (text: string) => void }) {
  return (
    <Page>
      <Title label="Story" className="px-on-scene">
        <span className="px-outlined">あなたの写真ストーリー</span>
      </Title>
      <p className="px-note px-note--float -mt-3">
        <Phrases text="このストーリーは、あなたのスマホでだけ見られます。" />
      </p>

      <Window title="きょうの道のり" as="section">
        <div className="px-mapframe">
          <DemoMap minutes={null} className="block h-auto w-full" />
        </div>
        <p className="mt-2 text-[13px] text-(--px-ink-2)">
          <Sentences text="地図はイメージです。線の種類は、道のりの確かさを表します。" />
        </p>
        <ul className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[13px]">
          {(["high", "mid", "low"] as const).map((certainty) => (
            <li key={certainty} className="flex items-center gap-1.5">
              <LineSample certainty={certainty} className="shrink-0" />
              <span>{CERTAINTY[certainty].short}</span>
            </li>
          ))}
          <li className="col-span-3 flex items-center gap-1.5">
            <LineSample certainty="unknown" className="shrink-0" />
            <span>{CERTAINTY.unknown.short}</span>
          </li>
        </ul>
      </Window>

      <Window title="写真と道のり" as="section">
        <ol className="px-timeline">
          {STOPS.map((stop, index) => {
            const leg = LEGS[index];
            return (
              <li key={stop.id}>
                <div className="px-timeline__stop">
                  {stop.photo ? (
                    <PixelPhoto name={stop.photo} className="px-timeline__thumb" label={`${DEMO_PHOTO_LABEL[stop.photo]}の写真`} />
                  ) : (
                    <span className="px-timeline__thumb grid place-items-center">
                      <PixelIcon name="star" size={36} className="px-symbol text-(--px-yellow)" label="あなたの記号（黄色い星）" />
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
                {leg && (
                  <div className="px-timeline__leg" data-certainty={leg.certainty}>
                    {leg.walkMinutes !== null ? (
                      <>
                        <p className="text-[14px]">
                          歩いた道のり（推定）約<span className="px-pixel mx-1 text-[12px]">{leg.walkMinutes}</span>分
                        </p>
                        <p className="text-[13px] text-(--px-ink-2)">
                          {CERTAINTY[leg.certainty].label}（{CERTAINTY[leg.certainty].line}）
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[14px]">{CERTAINTY.unknown.label}</p>
                        <p className="text-[13px] text-(--px-ink-2)">この間は位置が取れませんでした。</p>
                      </>
                    )}
                  </div>
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

/** 6. The end: thanks, how long the data stays, and deleting it now. */
function Thanks({ onClose, notify }: { onClose: () => void; notify: (text: string) => void }) {
  return (
    <Page>
      <div className="flex flex-col items-center gap-3 text-center">
        <PixelIcon name="star" size={72} className="px-symbol px-bob text-(--px-yellow)" />
        <Title label="Thank you" className="px-on-scene">
          <span className="px-outlined">
            <Phrases text="参加ありがとうございました" />
          </span>
        </Title>
      </div>

      <Window title="保存期間" as="section">
        <p className="text-[15px] leading-relaxed">
          <Sentences text="写真と道のりのデータは、展示が終わるまで保存し、その後削除します。具体的な期間は準備中です。" />
        </p>
      </Window>

      <Window title="データの削除" as="section">
        <p className="text-[15px] leading-relaxed">
          <Sentences text="期間の途中でも削除できます。写真だけ削除すると、道のりのデータは残ります。" />
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
