"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";
import type { LogEntry } from "@/lib/ping-log/store";

import { clock } from "../ui";
import { Print } from "./prints";
import { ConsentBody } from "./screens";
import { Icon, Phrases, Sentences, useRay, type IconName } from "./stage";

/**
 * The layers over a screen: the menu, how to play, the install guide, the
 * consent as agreed, and the questions before deleting a photo and before
 * withdrawing. Each closes on
 * Escape and its own close button; the screen behind is inert meanwhile.
 */

/** start: how to play between 「はじめる」 and the consent, leading on to it. */
export type OverlayName = "menu" | "howto" | "start" | "install" | "consent" | "stop" | "withdraw";

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

function steps(reminderMinutes: number) {
  return [
    { title: "芝浦祭を楽しむ", text: "第54回芝浦祭を、思いっきり楽しんでください。" },
    { title: "写真を撮る", text: `通知をオンにすると、${reminderMinutes}分ごとに撮影を知らせる通知が届きます。指示に従い、撮影と場所の選択をしてください。` },
    { title: "ShibaLab に行く", text: "お帰りの前に、ぜひ ShibaLab（教室棟301）にご来場ください。演出が楽しめます。" },
  ];
}

/** Before joining (onNext), its button leads on to the consent instead of closing. */
export function HowToLayer({ reminderMinutes, onNext, onClose }: { reminderMinutes: number; onNext?: () => void; onClose: () => void }) {
  const { go } = useRay();
  return (
    <Layer kind="full" label="遊び方" onClose={onClose}>
      <div className="full">
        <CloseBar label="How to" onClose={onClose} />
        <h1 className="h1" style={{ marginBottom: 12 }}>
          遊び方
        </h1>
        <ol style={{ listStyle: "none" }}>
          {steps(reminderMinutes).map((step, index) => (
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
        {onNext ? (
          <button type="button" className="btn" style={{ marginTop: 18 }} onClick={() => void go(onNext)}>
            次へ
            <Icon name="arrow" />
          </button>
        ) : (
          <button type="button" className="btn" style={{ marginTop: 18 }} onClick={onClose}>
            閉じる
          </button>
        )}
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
  reminderMinutes,
  beforeJoining,
  onContinue,
  onClose,
}: {
  support: PushSupport;
  reminderMinutes: number;
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

  // Brave on the iPhone has no 「ホーム画面に追加」, so from there the way is to Safari.
  const brave = support === "ios-browser" && "brave" in navigator;
  const ios = support === "ios-browser" && !brave;
  // iOS 26 and later keep 「共有」 in the 「…」 menu and open the share sheet folded; earlier ones, and the other tab
  // layouts, show the share button itself and a sheet to scroll.
  const steps: { icon: IconName | "app"; text: string; note?: string; copy?: boolean; shot?: { src: string; alt: string; width: number; height: number } }[] = [
    { icon: "share", text: "画面の下の「…」を押し、「共有」を押します。" },
    {
      icon: "more",
      text: "共有メニューの「表示を増やす」を押します。",
      note: "「表示を増やす」がないときは、メニューを下へスクロールします。",
      // Cut from a participant's iPhone (iOS 26), the button framed.
      shot: { src: "/log/install/ios-show-more.png", alt: "共有メニューの「表示を増やす」", width: 720, height: 236 },
    },
    {
      icon: "plus",
      text: "「ホーム画面に追加」を押し、「追加」を押します。",
      note: "「ホーム画面に追加」がないときは、リンクをコピーして Safari で開いてください。",
      copy: true,
      // Cut from a participant's iPhone (iOS 26), the row framed.
      shot: { src: "/log/install/ios-add-to-home.png", alt: "共有メニューの「ホーム画面に追加」", width: 720, height: 302 },
    },
    {
      icon: "app",
      text: beforeJoining
        ? "ホーム画面にできた TRACE のアイコンから開いてください。"
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
              <Sentences text={`この作品では、お使いの端末に通知を${reminderMinutes}分ごとに送り、定期的に写真を撮っていただきます。通知を受け取るため、このページをホーム画面に追加してください。`} />
            </p>
            <p className="small" style={{ marginTop: 8 }}>
              <Sentences
                text={
                  beforeJoining
                    ? "追加後は、そのアイコンからお開きください。"
                    : "アイコンから開くと、参加の同意からやり直しになります。ここで撮った写真は、アイコンから開いた画面には表示されません。"
                }
              />
            </p>
            <ol style={{ marginTop: 14 }}>
              {steps.map((step) => (
                <li key={step.icon} className={`install__step${step.shot ? " install__step--shot" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the home-screen icon itself, a fixed file */}
                  {step.icon === "app" ? <img className="install__app" src="/log/icon-192.png" alt="" width={32} height={32} /> : <Icon name={step.icon} />}
                  <div>
                    <p className="body">
                      <Sentences text={step.text} />
                    </p>
                    {step.note && (
                      <p className="small" style={{ marginTop: 4 }}>
                        <Sentences text={step.note} />
                        {step.copy && (
                          <>
                            {" "}
                            <button type="button" className="link" onClick={() => void copy()}>
                              {copied ? "コピーしました" : "リンクをコピー"}
                            </button>
                          </>
                        )}
                      </p>
                    )}
                    {/* eslint-disable-next-line @next/next/no-img-element -- a fixed screenshot; the static export has no image optimizer */}
                    {step.shot && <img className="install__shot" src={step.shot.src} alt={step.shot.alt} width={step.shot.width} height={step.shot.height} />}
                  </div>
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
                  brave
                    ? "Brave ではホーム画面に追加できません。リンクをコピーして、Safari で開いてください。"
                    : support !== "in-app"
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
              通知なしでこのまま参加する（非推奨）
            </button>
            <p className="small" style={{ marginTop: 8 }}>
              <Sentences text={"プライベートブラウズでは記録が正常に保存されません。通常のタブで開いてください。"} />
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

export function ConsentLayer({ terms, onClose }: { terms: Parameters<typeof ConsentBody>[0]["terms"]; onClose: () => void }) {
  return (
    <Layer kind="full" label="同意事項" onClose={onClose}>
      <div className="full">
        <ConsentBody terms={terms} onClose={onClose} />
      </div>
    </Layer>
  );
}

/**
 * The question before one photo is deleted (#51), with the photo in view.
 * onConfirm resolves to an error message, or null once the photo is gone;
 * on an error the photo stays, and the question stays up to try again.
 */
export function DeletePhotoLayer({
  entry,
  number,
  arrived,
  onConfirm,
  onClose,
}: {
  entry: LogEntry;
  number: number;
  /** After arriving, the photo leaves the keepsake too. */
  arrived: boolean;
  onConfirm: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const meta = entry.record.photo;
  const confirm = async () => {
    setWorking(true);
    setProblem("");
    const error = await onConfirm();
    setWorking(false);
    if (error) setProblem(error);
    else onClose();
  };
  return (
    <Layer kind="sheet" label={`${number}枚目の写真を削除しますか？`} alert onClose={working ? () => undefined : onClose}>
      <div className="scrim" onClick={working ? undefined : onClose} aria-hidden="true" />
      <div className="sheet-panel sheet-panel--bottom">
        <p className="mono">! Delete</p>
        <h2 className="h2" style={{ margin: "4px 0 8px" }}>
          <Phrases text={`${number}枚目の写真を削除しますか？`} />
        </h2>
        {entry.photo && (
          <div className="delete__print">
            <Print
              source={{ blob: entry.photo }}
              number={number}
              time={clock(entry.record.takenAt)}
              ratio={meta && meta.width > 0 && meta.height > 0 ? meta.width / meta.height : 3 / 4}
              small
            />
          </div>
        )}
        <p className="body">
          <Sentences text={`この写真と、選んだ場所の記録を削除します。${arrived ? "作品からも外れます。" : ""}削除した写真は元に戻せません。`} />
        </p>
        {problem && (
          <p className="problem" role="alert">
            <Sentences text={problem} />
          </p>
        )}
        <div className="btns" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn--danger" disabled={working} onClick={() => void confirm()}>
            {working ? "削除しています…" : "削除する"}
          </button>
          <button type="button" className="btn btn--line" disabled={working} onClick={onClose}>
            キャンセル
          </button>
        </div>
      </div>
    </Layer>
  );
}

/** Terminal participation stop, deliberately separate from destructive withdrawal. */
export function StopLayer({ onConfirm, onClose }: { onConfirm: () => Promise<string | null>; onClose: () => void }) {
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState("");
  const confirm = async () => {
    setWorking(true);
    const error = await onConfirm();
    setWorking(false);
    if (error) setProblem(error);
    else onClose();
  };
  return (
    <Layer kind="sheet" label="記録を残して参加を終了しますか？" alert onClose={working ? () => undefined : onClose}>
      <div className="scrim" onClick={working ? undefined : onClose} aria-hidden="true" />
      <div className="sheet-panel sheet-panel--bottom">
        <h2 className="h2">記録を残して参加を終了しますか？</h2>
        <p className="body"><Sentences text={"撮影・到着の受付とリマインダーを終了します。この参加は再開できません。保存期限までは写真の確認と記録の削除ができます。"} /></p>
        {problem && <p className="problem" role="alert"><Sentences text={problem} /></p>}
        <div className="btns" style={{ marginTop: 16 }}>
          <button type="button" className="btn" disabled={working} onClick={() => void confirm()}>{working ? "終了しています…" : "記録を残して終了する"}</button>
          <button type="button" className="btn btn--line" disabled={working} onClick={onClose}>キャンセル</button>
        </div>
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
          <Sentences text={"リマインダーを止め、この端末の写真と、参加の記録をすべて削除します。削除したものは元に戻せません。"} />
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
