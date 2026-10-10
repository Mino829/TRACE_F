"use client";

import type { ReactNode } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";

import { HowToSteps } from "./how-to-play";
import { InstallGuide } from "./install-guide";
import { PixelIcon } from "./pixel-icon";
import { Eyebrow, Frame, PxButton, PxLink, clock, remaining } from "./ui";

export type SetupStatus = {
  consent: boolean;
  notify: "done" | "skipped" | "denied" | "todo";
  location: "done" | "denied" | "todo";
  practice: "done" | "skipped" | "todo";
};

export function setupComplete(setup: SetupStatus): boolean {
  return setup.consent && setup.notify !== "todo" && setup.notify !== "denied" && setup.location === "done" && setup.practice !== "todo";
}

type Props = {
  setup: SetupStatus;
  /** Show the setup even when it is done (the developer screen's preview). */
  forceSetup: boolean;
  support: PushSupport;
  subscribed: boolean;
  nextPingAt: number;
  now: number;
  todayCount: number;
  todayUnsent: number;
  unsent: number;
  busy: boolean;
  geolocationDenied: boolean;
  onOpenConsent: () => void;
  onEnableNotifications: () => void;
  onSkipNotifications: () => void;
  onRequestLocation: () => void;
  onStartPractice: () => void;
  onSkipPractice: () => void;
  onCloseSetup: () => void;
  onRecordNow: () => void;
  onStopNotifications: () => void;
  onResend: () => void;
  onShowHowTo: () => void;
  onWithdraw: () => void;
};

export function HomeView(props: Props) {
  return setupComplete(props.setup) && !props.forceSetup ? <Playing {...props} /> : <Setup {...props} />;
}

type RowState = "done" | "current" | "todo";

/** One line of the setup quest: a check once done, the blinking cursor while it is the one to do. */
function QuestRow({ index, state, title, summary, children }: { index: number; state: RowState; title: string; summary: string; children?: ReactNode }) {
  return (
    <li className={`flex gap-3 border-t-2 border-(--px-panel-2) py-3 first:border-t-0 first:pt-0 ${state === "todo" ? "opacity-55" : ""}`} aria-current={state === "current" ? "step" : undefined}>
      <span
        className={`grid size-8 shrink-0 place-items-center ${state === "done" ? "bg-(--px-teal) text-[#0a0a0a]" : state === "current" ? "bg-(--px-pink) text-[#0a0a0a]" : "bg-(--px-panel-2) text-(--px-muted)"}`}
        aria-hidden="true"
      >
        {state === "done" ? <PixelIcon name="check" size={16} /> : state === "current" ? <span className="px-blink text-xs">&#9654;</span> : <span className="px-pixel text-[9px]">{index}</span>}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className={`font-bold ${state === "done" ? "text-(--px-teal)" : "text-(--px-ink)"}`}>
            {title}
            <span className="sr-only">{state === "done" ? "（完了）" : state === "current" ? "（いまの手順）" : "（これから）"}</span>
          </p>
          <p className="text-sm leading-relaxed text-(--px-muted)">{summary}</p>
        </div>
        {state === "current" && children}
      </div>
    </li>
  );
}

function Setup(props: Props) {
  const { setup } = props;
  const order: (keyof SetupStatus)[] = ["consent", "notify", "location", "practice"];
  const isDone = (key: keyof SetupStatus) =>
    key === "consent" ? setup.consent : key === "notify" ? setup.notify === "done" || setup.notify === "skipped" : key === "location" ? setup.location === "done" : setup.practice !== "todo";
  const current = order.find((key) => !isDone(key));
  const state = (key: keyof SetupStatus): RowState => (isDone(key) ? "done" : key === current ? "current" : "todo");
  const doneCount = order.filter(isDone).length;

  return (
    <>
      <Frame>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="space-y-1">
            <Eyebrow>Quest</Eyebrow>
            <h2 className="text-xl font-black text-(--px-teal)">はじめの準備</h2>
          </div>
          <p className="px-pixel text-[11px] text-(--px-ink)" aria-label={`4つのうち${doneCount}つ完了`}>
            {doneCount}/4
          </p>
        </div>
        <div className="mb-4 grid grid-cols-4 gap-1" aria-hidden="true">
          {order.map((key) => <span key={key} className={`h-2 ${isDone(key) ? "bg-(--px-teal)" : key === current ? "bg-(--px-pink)" : "bg-(--px-panel-2)"}`} />)}
        </div>
        <ol>
          <QuestRow index={1} state={state("consent")} title="参加の同意" summary={setup.consent ? "同意しました。" : "記録する情報と、その使い方を確認します。"}>
            <PxButton block onClick={props.onOpenConsent}>内容を確認する</PxButton>
          </QuestRow>
          <QuestRow
            index={2}
            state={state("notify")}
            title="通知をオンにする"
            summary={setup.notify === "done" ? "通知はオンです。" : setup.notify === "skipped" ? "通知なしで進めています。あとからオンにできます。" : "10分ごとの通知を受け取れるようにします。"}
          >
            <div className="space-y-2">
              {props.support === "supported" ? (
                <>
                  {setup.notify === "denied" && (
                    <p className="px-note" data-tone="warn">通知がブロックされています。ブラウザやスマホの設定で、このサイトの通知を許可してから、もう一度押してください。</p>
                  )}
                  <PxButton block icon="bell" onClick={props.onEnableNotifications} disabled={props.busy}>
                    {setup.notify === "denied" ? "もう一度試す" : "通知をオンにする"}
                  </PxButton>
                </>
              ) : (
                <InstallGuide support={props.support} />
              )}
              <PxLink onClick={props.onSkipNotifications}>通知なしで進む</PxLink>
            </div>
          </QuestRow>
          <QuestRow index={3} state={state("location")} title="位置情報を許可する" summary={setup.location === "done" ? "許可されています。" : "記録するときに、スマホの位置を測ります。"}>
            <div className="space-y-2">
              {setup.location === "denied" && (
                <p className="px-note" data-tone="warn">位置情報がブロックされています。スマホの設定で、このサイト（またはブラウザ）の位置情報を許可してから、もう一度押してください。</p>
              )}
              <PxButton block icon="pin" onClick={props.onRequestLocation} disabled={props.busy}>
                {setup.location === "denied" ? "もう一度試す" : "位置情報を許可する"}
              </PxButton>
            </div>
          </QuestRow>
          <QuestRow
            index={4}
            state={state("practice")}
            title="ためしに1回記録する"
            summary={setup.practice === "done" ? "練習しました。" : setup.practice === "skipped" ? "あとで練習できます。" : "本番と同じ手順を、いまいる場所で1回やってみます。1分ほどです。"}
          >
            <div className="space-y-2">
              <PxButton block icon="arrow" onClick={props.onStartPractice}>練習をはじめる</PxButton>
              <PxLink onClick={props.onSkipPractice}>あとでやる</PxLink>
            </div>
          </QuestRow>
        </ol>
        {props.forceSetup && setupComplete(setup) && (
          <div className="mt-2 border-t-2 border-(--px-panel-2) pt-2">
            <PxLink onClick={props.onCloseSetup}>準備の表示を閉じる</PxLink>
          </div>
        )}
      </Frame>

      <Frame tone="dim">
        <div className="mb-4 space-y-1">
          <Eyebrow soft>How to play</Eyebrow>
          <h2 className="text-lg font-black text-(--px-ink)">記録のしかた</h2>
        </div>
        <HowToSteps />
      </Frame>
    </>
  );
}

function Playing(props: Props) {
  const left = remaining(props.nextPingAt - props.now);
  const blocks = Math.min(props.todayCount, 36);

  return (
    <>
      {props.geolocationDenied && (
        <p className="px-note" data-tone="warn">位置情報がオフになっています。スマホの設定で、このサイト（またはブラウザ）の位置情報を許可してください。</p>
      )}

      <Frame>
        {props.subscribed ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>Next ping</Eyebrow>
              <span className="px-chip">ON</span>
            </div>
            <p className="px-digits" aria-label={`次の通知は${clock(props.nextPingAt)}ごろ`}>{clock(props.nextPingAt)}</p>
            <p className="text-sm">
              あと<span className="px-pixel mx-1 text-[12px] text-(--px-teal)">{left.minutes}:{String(left.seconds).padStart(2, "0")}</span>で次の通知が届きます。
            </p>
            <div className="flex items-center justify-between gap-3 pt-3">
              <p className="text-xs leading-relaxed text-(--px-muted)">画面が消えていても届きます。通知はその日の24時に止まります。</p>
              <PxButton variant="secondary" size="sm" onClick={props.onStopNotifications} disabled={props.busy}>止める</PxButton>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>Notify off</Eyebrow>
              <span className="px-chip px-chip--off">OFF</span>
            </div>
            <p className="text-sm">通知はオフです。オンにすると、10分ごとに記録の時間を知らせます。</p>
            {props.support === "supported" ? (
              <PxButton block variant="secondary" icon="bell" onClick={props.onEnableNotifications} disabled={props.busy}>通知をオンにする</PxButton>
            ) : (
              <InstallGuide support={props.support} />
            )}
          </div>
        )}
      </Frame>

      <div className="space-y-2">
        <PxButton block icon="pin" onClick={props.onRecordNow} className="text-lg!">いま記録する</PxButton>
        <p className="text-center text-xs text-(--px-text-soft)">通知を待たずに、いつでも記録できます。</p>
      </div>

      <section className="px-panel px-dark space-y-3" aria-label="きょうの記録">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow soft>Today</Eyebrow>
          <p className="text-sm">
            きょうの記録<span className="px-pixel ml-2 text-[14px] text-(--px-teal)">{props.todayCount}</span>
          </p>
        </div>
        {blocks > 0 ? (
          <div className="px-blocks" aria-hidden="true">
            {Array.from({ length: blocks }, (_, index) => <i key={index} className={index < props.todayUnsent ? "is-unsent" : undefined} />)}
          </div>
        ) : (
          <p className="text-sm text-(--px-muted)">まだ記録はありません。通知が届いたら記録しましょう。</p>
        )}
        {props.unsent > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-(--px-muted)">
            <span>未送信 {props.unsent}件。電波のよい場所で開くと送られます。</span>
            <PxButton variant="secondary" size="sm" onClick={props.onResend} disabled={props.busy}>いま送る</PxButton>
          </div>
        )}
      </section>

      <nav className="flex flex-col items-start text-(--px-text)" aria-label="そのほかの操作">
        <PxLink onClick={props.onShowHowTo}>遊び方を見る</PxLink>
        <PxLink onClick={props.onOpenConsent}>同意した内容を見る</PxLink>
        <PxLink onClick={props.onWithdraw} disabled={props.busy}>参加をやめる（送ったデータを削除）</PxLink>
      </nav>
    </>
  );
}
