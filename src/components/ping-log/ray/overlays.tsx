"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";
import { REMINDER_PLAN } from "@/lib/ping-log/push";

import { ConsentBody } from "./screens";
import { Icon, Phrases, Sentences, useRay, type IconName } from "./stage";

/**
 * The layers over a screen: the menu, how to play, the install guide, the
 * consent as agreed, and the question before withdrawing. Each closes on
 * Escape and its own close button; the screen behind is inert meanwhile.
 */

export type OverlayName = "menu" | "howto" | "install" | "consent" | "withdraw";

function Layer({ kind, label, alert = false, onClose, children }: { kind: "full" | "sheet"; label: string; alert?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const heading = ref.current?.querySelector<HTMLElement>("h1, h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Back to the button that opened it, if it is still there.
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  return (
    <section ref={ref} className={`screen overlay${kind === "sheet" ? " overlay--sheet" : ""}`} role={alert ? "alertdialog" : "dialog"} aria-modal="true" aria-label={label}>
      {children}
    </section>
  );
}

function CloseBar({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="topbar">
      <span>
        <button type="button" className="link" onClick={onClose}>
          <Icon name="close" />
          閉じる
        </button>
      </span>
      <span className="mono">{label}</span>
      <span />
    </div>
  );
}

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean };

export function MenuLayer({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <Layer kind="sheet" label="メニュー" onClose={onClose}>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div className="sheet-panel inv">
        <div className="topbar">
          <span className="mono">Menu</span>
          <span />
          <span>
            <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
              <Icon name="close" />
            </button>
          </span>
        </div>
        <h2 className="h1">メニュー</h2>
        <ul className="menu-list">
          {items.map((item) => (
            <li key={item.label}>
              <button type="button" disabled={item.disabled} onClick={item.onSelect}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn--line" style={{ marginTop: 18 }} onClick={onClose}>
          閉じる
        </button>
      </div>
    </Layer>
  );
}

const STEPS = [
  { title: "写真を撮る", text: "残したい瞬間を見つけたら、「写真を撮る」を押して撮影します。" },
  { title: "学祭をめぐる", text: "撮影と撮影のあいだは、自由に学祭をめぐってください。" },
  {
    title: "ShibaLab で QR を読む",
    text: "ShibaLab（教室棟301）には、好きなときに来てください。着いたら、ホームの「QR コードを読み取る」を押して、ASYNC のブースにある QR コードを読み取ってください。",
  },
];

export function HowToLayer({ maxPhotos, onClose }: { maxPhotos: number; onClose: () => void }) {
  const notes = [
    "撮った写真は、展示に出しません。",
    `撮影は${maxPhotos}枚までです。`,
    `撮影のリマインダーは任意です。オンにすると、${REMINDER_PLAN.intervalMinutes}分ごとに届きます。`,
    "撮りたいものがないときは、リマインダーをスキップして構いません。",
  ];
  return (
    <Layer kind="full" label="遊び方" onClose={onClose}>
      <div className="full">
        <CloseBar label="How to" onClose={onClose} />
        <h1 className="h1" style={{ marginBottom: 12 }}>
          遊び方
        </h1>
        <ol style={{ listStyle: "none" }}>
          {STEPS.map((step, index) => (
            <li key={step.title} className="howto__step">
              <span className="howto__n" aria-hidden="true">
                {index + 1}
              </span>
              <div>
                <h2 className="h3">{step.title}</h2>
                <p className="body">
                  <Sentences text={step.text} />
                </p>
              </div>
            </li>
          ))}
        </ol>
        <ul className="notes">
          {notes.map((note) => (
            <li key={note}>
              <Sentences text={note} />
            </li>
          ))}
        </ul>
        <button type="button" className="btn" style={{ marginTop: 18 }} onClick={onClose}>
          閉じる
        </button>
      </div>
    </Layer>
  );
}

/**
 * What to do when this browser cannot receive the optional reminder, with
 * the exact taps. Before joining, the home-screen app keeps its own storage,
 * so the advice is to move first. From the title in an iPhone's tab it also
 * offers to join here without notifications (onContinue); from the title in
 * an in-app browser it is the way to Safari or Chrome, where joining has to start.
 */
export function InstallLayer({
  support,
  beforeJoining,
  onContinue,
  onClose,
}: {
  support: PushSupport;
  beforeJoining: boolean;
  onContinue?: () => void;
  onClose: () => void;
}) {
  const { go } = useRay();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href.split("#")[0]);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const ios = support === "ios-browser";
  const steps: { icon: IconName; text: string }[] = [
    { icon: "share", text: "画面の下（iPad は上）にある共有ボタンを押します。" },
    { icon: "plus", text: "「ホーム画面に追加」を選び、「追加」を押します。" },
    {
      icon: "bell",
      text: beforeJoining
        ? "ホーム画面にできた TRACE のアイコンから開き、そこで「はじめる」を押してください。"
        : "ホーム画面にできた TRACE のアイコンから開き直すと、リマインダーをオンにできます。",
    },
  ];
  const heading = ios ? "iPhone で通知を受け取るには" : support === "in-app" ? "アプリの中で開いています" : "このブラウザでは通知を受け取れません";

  return (
    <Layer kind="full" label={heading} onClose={onClose}>
      <div className="full">
        <CloseBar label={ios ? "iPhone" : "Notice"} onClose={onClose} />
        {ios ? (
          <>
            <h1 className="h2">
              <Phrases text={heading} />
            </h1>
            <p className="body" style={{ marginTop: 10 }}>
              <Sentences text="iPhone では、このページをホーム画面に追加すると、撮影のリマインダーを通知で受け取れます（iOS 16.4 以降）。" />
            </p>
            <p className="small" style={{ marginTop: 8 }}>
              <Sentences
                text={
                  beforeJoining
                    ? "ホーム画面のアイコンから開いた TRACE は、このページとは別に記録を保存します。リマインダーを使う場合は、先に移ってから参加してください。"
                    : "アイコンから開くと、参加の同意からやり直しになります。ここで撮った写真は、アイコンから開いた画面には表示されません。"
                }
              />
            </p>
            <ol style={{ marginTop: 14 }}>
              {steps.map((step) => (
                <li key={step.icon} className="install__step">
                  <Icon name={step.icon} />
                  <p className="body">
                    <Sentences text={step.text} />
                  </p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <h1 className="h2">
              <Phrases text={heading} />
            </h1>
            <p className="body" style={{ marginTop: 10 }}>
              <Sentences
                text={
                  support !== "in-app"
                    ? "リマインダーを使う場合は、リンクをコピーして Safari か Chrome で開いてください。"
                    : beforeJoining
                      ? "アプリの中で開いたページの記録は、Safari や Chrome に引き継げません。アプリのメニューの「ブラウザで開く」を選ぶか、リンクをコピーして Safari か Chrome で開いてから、参加してください。"
                      : "LINE などのアプリの中で開いたページでは、通知を受け取れません。リマインダーを使う場合は、アプリのメニューの「ブラウザで開く」を選ぶか、リンクをコピーして Safari か Chrome で開いてください。"
                }
              />
            </p>
            <button type="button" className="btn" style={{ marginTop: 18 }} onClick={() => void copy()}>
              <Icon name={copied ? "check" : "copy"} />
              {copied ? "コピーしました" : "リンクをコピー"}
            </button>
          </>
        )}
        {onContinue ? (
          <>
            <button type="button" className="btn btn--line" style={{ marginTop: 18 }} onClick={() => void go(onContinue)}>
              通知なしでこのまま参加する
            </button>
            <p className="small" style={{ marginTop: 8 }}>
              <Sentences text="プライベートブラウズでは記録が正常に保存されません。通常のタブで開いてください。" />
            </p>
          </>
        ) : (
          <button type="button" className="btn btn--line" style={{ marginTop: 18 }} onClick={onClose}>
            閉じる
          </button>
        )}
      </div>
    </Layer>
  );
}

export function ConsentLayer({ onClose }: { onClose: () => void }) {
  return (
    <Layer kind="full" label="同意した内容" onClose={onClose}>
      <div className="full">
        <ConsentBody onClose={onClose} />
      </div>
    </Layer>
  );
}

export function WithdrawLayer({ onConfirm, onClose }: { onConfirm: () => Promise<void>; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  const confirm = async () => {
    setWorking(true);
    try {
      await onConfirm();
    } finally {
      setWorking(false);
    }
  };
  return (
    <Layer kind="sheet" label="参加をやめますか？" alert onClose={working ? () => undefined : onClose}>
      <div className="scrim" onClick={working ? undefined : onClose} aria-hidden="true" />
      <div className="sheet-panel sheet-panel--bottom">
        <p className="mono">! Withdraw</p>
        <h2 className="h2" style={{ margin: "4px 0 8px" }}>
          参加をやめますか？
        </h2>
        <p className="body">
          <Sentences text="リマインダーを止め、この端末から送った写真と記録をすべて削除します。削除したものは元に戻せません。" />
        </p>
        <div className="btns" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--danger" disabled={working} onClick={() => void confirm()}>
            {working ? "削除しています…" : "やめて削除する"}
          </button>
          <button type="button" className="btn btn--line" disabled={working} onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </Layer>
  );
}
