"use client";

import { useState } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";

import { PixelIcon, type PixelIconName } from "./pixel-icon";
import { Phrases, PxButton, PxLink, Sentences } from "./ui";

type Props = {
  support: Exclude<PushSupport, "supported">;
  /**
   * Shown before consent, on the title screen. The home-screen app and an
   * in-app browser each keep their own storage, so whatever is agreed and
   * photographed here stays here: better to move first.
   */
  beforeJoining?: boolean;
};

/**
 * What to do when this browser cannot receive the optional photo reminder.
 * Each case names the exact taps, because "this browser is not supported"
 * leaves people stuck.
 */
export function InstallGuide({ support, beforeJoining = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href.split("#")[0]);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (support === "ios-browser") {
    const steps: { icon: PixelIconName; text: string }[] = [
      { icon: "share", text: "画面の下（iPad は上）にある共有ボタンを押します。" },
      { icon: "add", text: "「ホーム画面に追加」を選び、「追加」を押します。" },
      { icon: "bell", text: beforeJoining ? "ホーム画面にできた TRACE のアイコンから開き、そこで「はじめる」を押してください。" : "ホーム画面にできた TRACE のアイコンから開き直すと、リマインダーをオンにできます。" },
    ];
    return (
      <div className="space-y-3">
        <p className="text-[15px]">
          <Phrases text="iPhone では、このページをホーム画面に追加すると、撮影のリマインダーを通知で受け取れます" />
          <span className="whitespace-nowrap">（iOS 16.4 以降）</span>。
        </p>
        {!open ? (
          <PxLink onClick={() => setOpen(true)} aria-expanded={false}>
            追加のしかたを見る
          </PxLink>
        ) : (
          <>
            <p className="text-[14px] leading-relaxed text-(--px-ink-2)">
              <Sentences
                text={
                  beforeJoining
                    ? "ホーム画面のアイコンから開いた TRACE は、このページとは別に記録を保存します。リマインダーを使う場合は、先に移ってから参加してください。"
                    : "アイコンから開くと、参加の同意からやり直しになります。ここで撮った写真は、アイコンから開いた画面には表示されません。"
                }
              />
            </p>
            <ol className="space-y-2">
              {steps.map((step, index) => (
                <li key={step.icon} className="flex items-start gap-2 bg-(--px-navy-2) p-3 text-[15px]">
                  <span className="px-pixel mt-0.5 text-[10px] text-(--px-yellow)">{index + 1}</span>
                  <PixelIcon name={step.icon} size={24} className="shrink-0 text-(--px-cyan)" />
                  <span className="min-w-0">
                    <Sentences text={step.text} />
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[15px]">
        <Sentences
          text={
            support === "in-app"
              ? "LINE などのアプリの中で開いたページでは、通知を受け取れません。リマインダーを使う場合は、アプリのメニューの「ブラウザで開く」を選ぶか、リンクをコピーして Safari か Chrome で開いてください。"
              : "このブラウザでは通知を受け取れません。リマインダーを使う場合は、リンクをコピーして Safari か Chrome で開いてください。"
          }
        />
      </p>
      <PxButton variant="secondary" size="sm" icon={copied ? "check" : "copy"} onClick={() => void copy()}>
        {copied ? "コピーしました" : "リンクをコピー"}
      </PxButton>
    </div>
  );
}
