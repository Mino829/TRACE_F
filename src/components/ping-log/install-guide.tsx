"use client";

import { useState } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";

import { PixelIcon, type PixelIconName } from "./pixel-icon";
import { PxButton } from "./ui";

/**
 * What to do when this browser cannot receive the ping. Each case names the
 * exact taps, because "this browser is not supported" leaves people stuck.
 */
export function InstallGuide({ support }: { support: Exclude<PushSupport, "supported"> }) {
  const [copied, setCopied] = useState(false);

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
      { icon: "add", text: "メニューの「ホーム画面に追加」を選び、「追加」を押します。" },
      { icon: "bell", text: "ホーム画面にできた TRACE のアイコンから開き直すと、通知をオンにできます。" },
    ];
    return (
      <div className="space-y-3">
        <p className="text-sm">iPhone では、このページをホーム画面に追加すると通知を受け取れます（iOS 16.4 以降）。</p>
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={step.icon} className="flex items-start gap-3 bg-(--px-panel-2) p-3 text-sm">
              <span className="px-pixel mt-0.5 text-[10px] text-(--px-pink-soft)">{index + 1}</span>
              <PixelIcon name={step.icon} size={22} className="text-(--px-teal)" />
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {support === "in-app"
          ? "LINE などのアプリの中で開いたページでは、通知を受け取れません。メニューの「ブラウザで開く」を選ぶか、リンクをコピーして Safari か Chrome で開いてください。"
          : "このブラウザでは通知を受け取れません。リンクをコピーして、Safari か Chrome で開いてください。"}
      </p>
      <PxButton variant="secondary" size="sm" onClick={() => void copy()}>{copied ? "コピーしました" : "リンクをコピー"}</PxButton>
    </div>
  );
}
