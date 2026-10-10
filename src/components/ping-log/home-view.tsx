"use client";

import type { ReactNode } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";

import { InstallGuide } from "./install-guide";
import { PixelIcon } from "./pixel-icon";
import { PixelSprite } from "./pixel-sprite";
import { PxButton, PxLink, Window, clock, remaining } from "./ui";

export type SetupStatus = {
  consent: boolean;
  notify: "done" | "skipped" | "denied" | "todo";
  location: "done" | "denied" | "todo";
  practice: "done" | "skipped" | "todo";
};

export function setupComplete(setup: SetupStatus): boolean {
  return setup.consent && setup.notify !== "todo" && setup.notify !== "denied" && setup.location === "done" && setup.practice !== "todo";
}

const PING_MINUTES = 10;
/** Coins shown before the rest are counted as "+N". */
const MAX_COINS = 20;

type Props = {
  setup: SetupStatus;
  /** Show the setup even when it is done (the developer screen's preview). */
  forceSetup: boolean;
  support: PushSupport;
  subscribed: boolean;
  /** A ping is waiting: its banner holds the yellow button, so ours steps back. */
  pending: boolean;
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

type StageState = "done" | "current" | "todo";

/** One stage of the setup quest: a check once cleared, the blinking cursor while it is the one to do, a lock after. */
function Stage({ state, title, summary, children }: { state: StageState; title: string; summary: string; children?: ReactNode }) {
  return (
    <li className="px-quest__stage" data-state={state} aria-current={state === "current" ? "step" : undefined}>
      <span className="px-quest__node" aria-hidden="true">
        {state === "done" ? <PixelIcon name="check" size={20} /> : state === "current" ? <span className="px-blink text-[14px]">&#9654;</span> : <PixelIcon name="lock" size={18} />}
      </span>
      <div className="px-quest__body min-w-0 flex-1 pt-1">
        <p className={`text-[17px] leading-snug ${state === "done" ? "text-(--px-green)" : ""}`}>
          {title}
          <span className="px-sr">{state === "done" ? "（完了）" : state === "current" ? "（いまの手順）" : "（これから）"}</span>
        </p>
        <p className="mt-0.5 text-[14px] leading-relaxed text-(--px-ink-2)">{summary}</p>
        {state === "current" && children && <div className="mt-3 space-y-1">{children}</div>}
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
  const state = (key: keyof SetupStatus): StageState => (isDone(key) ? "done" : key === current ? "current" : "todo");
  const doneCount = order.filter(isDone).length;

  return (
    <>
      <Window title="はじめの準備">
        <div className="flex items-center gap-3" aria-label={`4つのうち${doneCount}つ完了`}>
          <div className="px-charge flex-1" style={{ gridTemplateColumns: "repeat(4, 1fr)" }} aria-hidden="true">
            {order.map((key) => <i key={key} className={isDone(key) ? "is-full" : key === current ? "is-filling" : undefined} />)}
          </div>
          <span className="px-pixel text-[12px]" aria-hidden="true">{doneCount}/4</span>
        </div>
        <ol className="px-quest mt-5">
          <Stage state={state("consent")} title="参加の同意" summary={setup.consent ? "同意しました。" : "記録する情報と、その使い方を確認します。"}>
            <PxButton block onClick={props.onOpenConsent}>内容を確認する</PxButton>
          </Stage>
          <Stage
            state={state("notify")}
            title="通知をオンにする"
            summary={setup.notify === "done" ? "通知はオンです。" : setup.notify === "skipped" ? "通知なしで進めています。あとからオンにできます。" : "10分ごとに、記録の時間を知らせます。"}
          >
            {props.support === "supported" ? (
              <>
                {setup.notify === "denied" && (
                  <p className="px-note mb-2" data-tone="warn">通知がブロックされています。スマホやブラウザの設定で、このサイトの通知を許可してから、もう一度押してください。</p>
                )}
                <PxButton block icon="bell" onClick={props.onEnableNotifications} disabled={props.busy}>
                  {setup.notify === "denied" ? "もう一度試す" : "通知をオンにする"}
                </PxButton>
              </>
            ) : (
              <InstallGuide support={props.support} />
            )}
            <PxLink onClick={props.onSkipNotifications}>通知なしで進む</PxLink>
          </Stage>
          <Stage state={state("location")} title="位置情報を許可する" summary={setup.location === "done" ? "許可されています。" : "記録するときだけ、スマホの位置を測ります。"}>
            {setup.location === "denied" && (
              <p className="px-note mb-2" data-tone="warn">位置情報がブロックされています。スマホの設定で、このサイト（またはブラウザ）の位置情報を許可してから、もう一度押してください。</p>
            )}
            <PxButton block icon="pin" onClick={props.onRequestLocation} disabled={props.busy}>
              {setup.location === "denied" ? "もう一度試す" : "位置情報を許可する"}
            </PxButton>
          </Stage>
          <Stage
            state={state("practice")}
            title="ためしに1回記録する"
            summary={setup.practice === "done" ? "練習しました。" : setup.practice === "skipped" ? "あとで練習できます。" : "本番と同じ手順を、いまいる場所で1回やってみます。"}
          >
            <PxButton block icon="arrow" onClick={props.onStartPractice}>練習をはじめる</PxButton>
            <PxLink onClick={props.onSkipPractice}>あとでやる</PxLink>
          </Stage>
        </ol>
        <div className="mt-4 flex flex-wrap gap-x-4 border-t-3 border-(--px-navy-3) pt-2">
          <PxLink onClick={props.onShowHowTo}>遊び方を見る</PxLink>
          {props.forceSetup && setupComplete(setup) && <PxLink onClick={props.onCloseSetup}>準備の表示を閉じる</PxLink>}
        </div>
      </Window>
    </>
  );
}

/** Ten cells for the ten minutes between pings; the one filling now blinks. */
function Charge({ nextPingAt, now }: { nextPingAt: number; now: number }) {
  const elapsed = Math.floor((now - (nextPingAt - PING_MINUTES * 60_000)) / 60_000);
  return (
    <div className="px-charge" aria-hidden="true">
      {Array.from({ length: PING_MINUTES }, (_, index) => (
        <i key={index} className={index < elapsed ? "is-full" : index === elapsed ? "is-filling" : undefined} />
      ))}
    </div>
  );
}

function Playing(props: Props) {
  const left = remaining(props.nextPingAt - props.now);
  const coins = Math.min(props.todayCount, MAX_COINS);
  const sentCoins = Math.max(0, coins - props.todayUnsent);

  return (
    <>
      {props.geolocationDenied && (
        <p className="px-note px-note--float" data-tone="warn">位置情報がオフになっています。スマホの設定で、このサイト（またはブラウザ）の位置情報を許可してください。</p>
      )}

      <Window title={props.subscribed ? "つぎの通知" : "通知"} as="section" aria-label="通知と、きょうの記録">
        {props.subscribed ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <p className="px-digits" aria-label={`次の通知は${clock(props.nextPingAt)}ごろ`}>{clock(props.nextPingAt)}</p>
              <div className="flex flex-col items-end gap-1 pb-1">
                <span className="px-chip">ON</span>
                <p className="text-[14px] text-(--px-ink-2)">
                  あと<span className="px-pixel ml-1.5 text-[12px] text-(--px-yellow)">{left.minutes}:{String(left.seconds).padStart(2, "0")}</span>
                </p>
              </div>
            </div>
            <div className="mt-3">
              <Charge nextPingAt={props.nextPingAt} now={props.now} />
            </div>
            <p className="mt-2 text-[14px] leading-relaxed text-(--px-ink-2)">画面を消していても届きます。通知はきょうの24時に止まります。</p>
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[17px]">通知はオフです</p>
              <span className="px-chip px-chip--off">OFF</span>
            </div>
            <p className="text-[14px] leading-relaxed text-(--px-ink-2)">オンにすると、10分ごとに記録の時間を知らせます。</p>
            {props.support === "supported" ? (
              <PxButton block variant="secondary" icon="bell" onClick={props.onEnableNotifications} disabled={props.busy}>通知をオンにする</PxButton>
            ) : (
              <InstallGuide support={props.support} />
            )}
          </div>
        )}

        <div className="mt-4 border-t-3 border-(--px-navy-3) pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px]">きょうの記録</p>
            <p className="px-pixel text-[14px] text-(--px-yellow)" aria-label={`${props.todayCount}回`}>
              &times;{props.todayCount}
            </p>
          </div>
          {coins > 0 ? (
            <div className="px-coins mt-2" aria-hidden="true">
              {Array.from({ length: coins }, (_, index) => (
                <PixelSprite key={index} name="coin" scale={2} className={index >= sentCoins ? "is-unsent" : undefined} />
              ))}
              {props.todayCount > MAX_COINS && <span className="px-pixel self-center text-[10px] text-(--px-ink-2)">+{props.todayCount - MAX_COINS}</span>}
            </div>
          ) : (
            <p className="mt-1 text-[14px] text-(--px-ink-2)">まだありません。1回記録すると、コインが1枚増えます。</p>
          )}
          {props.unsent > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] text-(--px-ink-2)">未送信 {props.unsent}件（うすいコイン）。電波のよい場所で送れます。</p>
              <PxButton variant="secondary" size="sm" onClick={props.onResend} disabled={props.busy}>いま送る</PxButton>
            </div>
          )}
        </div>
      </Window>

      <div className="px-on-scene">
        <PxButton block size="lg" icon="pin" variant={props.pending ? "secondary" : "primary"} onClick={props.onRecordNow}>いま記録する</PxButton>
      </div>

      <Window tone="dim" title="メニュー" as="section">
        <ul className="px-menu grid grid-cols-2">
          <li><button type="button" className="px-menu__item" onClick={props.onShowHowTo}>遊び方</button></li>
          <li><button type="button" className="px-menu__item" onClick={props.onOpenConsent}>同意した内容</button></li>
          {props.subscribed && (
            <li><button type="button" className="px-menu__item" onClick={props.onStopNotifications} disabled={props.busy}>通知を止める</button></li>
          )}
          <li><button type="button" className="px-menu__item" data-tone="danger" onClick={props.onWithdraw} disabled={props.busy}>参加をやめる</button></li>
        </ul>
      </Window>
    </>
  );
}
