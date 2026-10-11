"use client";

import type { PushSupport } from "@/lib/ping-log/environment";

import { HowToStrip } from "./how-to-play";
import { InstallGuide } from "./install-guide";
import { PixelSprite } from "./pixel-sprite";
import { InfoButton, InfoNote, PxButton, Phrases, Sentences, Window, useInfo } from "./ui";

type Props = {
  support: PushSupport;
  onStart: () => void;
};

/**
 * The first screen: what the work is, in one window, and one button. It
 * reads as a photo log; what the exhibition does with the day waits for the
 * visit to ShibaLab. Where
 * notifications cannot arrive (Safari on an iPhone, an app's own browser),
 * the way to get the optional reminder sits below in a quieter window,
 * since moving there first means joining there.
 */
export function TitleView({ support, onStart }: Props) {
  const info = useInfo();

  return (
    <div className="space-y-6">
      <header className="-mt-6 flex flex-col items-center text-center">
        <PixelSprite name="pin" scale={5} className="px-bob" />
        <h1 className="px-logo mt-4">TRACE</h1>
        <p className="px-outlined mt-5 text-[17px]">写真で残す、学祭の一日</p>
      </header>

      <Window title="TRACE とは">
        <p className="text-[15px] leading-relaxed">
          <Sentences text="学祭で残したい瞬間を、写真に撮ってください。撮った写真は、あなたの一日のメモリーになります。" />
        </p>
        <div className="mt-3">
          <HowToStrip />
        </div>
        <p className="mt-3 text-[14px] leading-relaxed text-(--px-ink-2)">
          <Phrases text="写真がたまったら、ShibaLab（教室棟301）に来てください。" />
          <InfoButton info={info} label="写真の扱いについて" />
        </p>
        <InfoNote info={info}>
          <Sentences text="撮った写真は、展示に出しません。写真ストーリーは、あなたのスマホでだけ見られます。参加は任意です。" />
        </InfoNote>
      </Window>

      <div className="px-on-scene">
        <PxButton block size="lg" icon="arrow" onClick={onStart}>はじめる</PxButton>
      </div>

      {support !== "supported" && (
        <Window tone="dim" title={support === "ios-browser" ? "iPhone で通知を受け取るには" : support === "in-app" ? "アプリの中で開いています" : "通知について"}>
          <InstallGuide support={support} beforeJoining />
        </Window>
      )}
    </div>
  );
}
