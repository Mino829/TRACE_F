"use client";

import type { PushSupport } from "@/lib/ping-log/environment";

import { HowToStrip } from "./how-to-play";
import { InstallGuide } from "./install-guide";
import { PixelSprite } from "./pixel-sprite";
import { PxButton, PxLink, Window } from "./ui";

type Props = {
  support: PushSupport;
  onStart: () => void;
  /** Join here anyway, knowing no ping will come. */
  onStartWithoutNotifications: () => void;
};

/**
 * The first screen: what this is, in one window, and one button. Where the
 * ping cannot reach (Safari on an iPhone, an app's own browser), the move to
 * where it can comes first, before anything is agreed.
 */
export function TitleView({ support, onStart, onStartWithoutNotifications }: Props) {
  const moveFirst = support === "ios-browser" || support === "in-app";

  return (
    <div className="space-y-6">
      <header className="-mt-6 flex flex-col items-center text-center">
        <PixelSprite name="pin" scale={5} className="px-bob" />
        <h1 className="px-logo mt-4">TRACE</h1>
        <p className="px-outlined mt-5 text-[17px]">いまいる場所の記録</p>
      </header>

      <Window title="どんな実験？">
        <p className="text-[15px] leading-relaxed">
          スマホの位置情報が、ほんとうの場所からどれくらいずれるかを調べる実験です。10分ごとに届く通知に答えて、いまいる場所を教えてください。
        </p>
        <div className="mt-3">
          <HowToStrip />
        </div>
        <p className="mt-3 text-[14px] text-(--px-ink-2)">1回の記録は、タップ4回ほどで終わります。参加は任意です。</p>
      </Window>

      {moveFirst ? (
        <Window tone="alert" title={support === "ios-browser" ? "iPhone の方へ" : "アプリの中で開いています"}>
          <InstallGuide support={support} beforeJoining />
          <div className="mt-3 border-t-3 border-(--px-navy-3) pt-2">
            <PxLink onClick={onStartWithoutNotifications}>通知なしで、このまま参加する</PxLink>
          </div>
        </Window>
      ) : (
        <div className="px-on-scene">
          <PxButton block size="lg" icon="arrow" onClick={onStart}>はじめる</PxButton>
        </div>
      )}
    </div>
  );
}
