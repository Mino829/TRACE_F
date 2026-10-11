"use client";

import { useEffect, useRef } from "react";

import { useLayer } from "./layer";
import { PixelSprite } from "./pixel-sprite";
import { Phrases, PxButton, Sentences, Window, clock } from "./ui";

/**
 * The end of every answer: "CLEAR!". A photo, a skipped reminder and an
 * accuracy record all end on it, so leaving the camera closed is never the
 * losing choice. A photo also earns a coin.
 */

export function ClearTitle() {
  return (
    <p className="px-clear" aria-hidden="true">
      CLEAR!
    </p>
  );
}

/** The coin an answer earns, spinning, with its +1 beside it or, where the side has no room, above it. */
export function CoinGain({ scale = 6, plus = "beside" }: { scale?: number; plus?: "beside" | "above" }) {
  return (
    <div className="relative mx-auto w-fit" aria-hidden="true">
      <PixelSprite name="coin" scale={scale} className="px-coin-spin" />
      <span
        className={`px-rise px-pixel px-outlined absolute text-[16px] text-(--px-yellow)! ${plus === "beside" ? "top-3 -right-11" : "bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2"}`}
      >
        +1
      </span>
    </div>
  );
}

const CONFETTI = (() => {
  const colours = ["var(--px-yellow)", "var(--px-cyan)", "var(--px-green)", "var(--px-red)", "var(--px-ink)"];
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 30 }, (_, index) => ({
    left: `${random() * 100}%`,
    colour: colours[index % colours.length],
    dx: `${Math.round(random() * 80 - 40)}px`,
    dy: `${Math.round(55 + random() * 35)}vh`,
    duration: `${(1.4 + random() * 1).toFixed(2)}s`,
    delay: `${(random() * 0.5).toFixed(2)}s`,
  }));
})();

/** A burst of pixel squares, once. */
export function Confetti() {
  return (
    <div className="px-confetti" aria-hidden="true">
      {CONFETTI.map((piece, index) => (
        <i
          key={index}
          style={{
            left: piece.left,
            ["--c" as string]: piece.colour,
            ["--dx" as string]: piece.dx,
            ["--dy" as string]: piece.dy,
            ["--d" as string]: piece.duration,
            ["--delay" as string]: piece.delay,
          }}
        />
      ))}
    </div>
  );
}

/** The clear screen for a reminder answered with "スキップ". */
export function SkipClear({ nextReminderAt, onClose }: { nextReminderAt: number | null; onClose: () => void }) {
  const close = useLayer("#clear", onClose);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <div className="px-stage fixed inset-0 z-40 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="skip-title">
      <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden px-4 pt-[env(safe-area-inset-top)] text-center">
        <Confetti />
        <div className="relative w-full space-y-6">
          <ClearTitle />
          <Window className="text-left">
            <div role="status" className="space-y-2">
              <h2 id="skip-title" ref={titleRef} tabIndex={-1} className="text-[19px] outline-none">
                <Phrases text="今回はスキップしました" />
              </h2>
              <p className="text-[15px] text-(--px-ink-2)">
                <Sentences text={`撮りたいものがあるときだけ撮れば十分です。${nextReminderAt !== null ? `次のリマインダーは ${clock(nextReminderAt)} ごろです。` : ""}`} />
              </p>
            </div>
          </Window>
        </div>
      </div>
      <div className="px-actionbar">
        <PxButton block onClick={close}>
          ホームへもどる
        </PxButton>
      </div>
    </div>
  );
}
