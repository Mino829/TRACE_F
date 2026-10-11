"use client";

import { useState } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";
import type { PushPlan, ReminderInterval } from "@/lib/ping-log/push";
import { MAX_PHOTOS_PER_DAY } from "@/lib/ping-log/record";
import type { LogEntry } from "@/lib/ping-log/store";

import { BlobImage } from "./blob-image";
import { InstallGuide } from "./install-guide";
import { PixelSprite } from "./pixel-sprite";
import { ReminderChoice } from "./reminder-choice";
import { InfoButton, InfoNote, PxButton, Sentences, Tip, Window, clock, remaining, useInfo } from "./ui";

/**
 * The participant's home once they have joined: a reminder waiting for an
 * answer, today's photos, the camera button and the optional reminder. The
 * menu lives behind the header's button; details sit behind "i" marks.
 * Nothing here mentions where photos were taken: that stays a surprise for
 * the exhibition, and only the consent lists it.
 */

/** Coins shown before the rest are counted as "+N". */
const MAX_COINS = 20;

type Props = {
  support: PushSupport;
  /** The phone's subscription while it lasts; it may be the developer screen's accuracy ping. */
  plan: PushPlan | null;
  /** Null past the day's last ping. */
  nextPingAt: number | null;
  /** A reminder waiting for an answer: its banner holds the yellow button, so the camera button steps back. */
  pendingAt: string | null;
  now: number;
  /** Today's photos, oldest first. */
  photos: LogEntry[];
  /** One coin per photo and per skipped reminder today. */
  coins: number;
  /**
   * Today's photos still waiting to be sent, drawn faded. Earlier days' photos
   * wait too, out of sight here, and go with the next send.
   */
  unsentCoins: number;
  busy: boolean;
  onTakePhoto: () => void;
  onSkipReminder: () => void;
  /** Resolves to an error message, or null once the reminder is on. */
  onEnableReminders: (interval: ReminderInterval) => Promise<string | null>;
  onResend: () => void;
};

export function HomeView(props: Props) {
  const [reminderProblem, setReminderProblem] = useState("");
  const photosInfo = useInfo();
  const coinsInfo = useInfo();
  const reminderInfo = useInfo();
  const full = props.photos.length >= MAX_PHOTOS_PER_DAY;
  const reminderOn = props.plan?.purpose === "photo";

  const enable = async (interval: ReminderInterval) => {
    setReminderProblem("");
    setReminderProblem((await props.onEnableReminders(interval)) ?? "");
  };

  return (
    <>
      {props.pendingAt && (
        <Window tone="alert" title={<><span className="px-blink">!</span> 撮影のリマインダー</>} as="section">
          <p className="text-[16px]">
            <Sentences text={`${clock(props.pendingAt)} のリマインダーです。残したい景色があれば、写真を撮ってみませんか。`} />
          </p>
          <div className="mt-3 flex gap-1">
            <PxButton variant="secondary" onClick={props.onSkipReminder}>スキップ</PxButton>
            <PxButton block icon="camera" onClick={props.onTakePhoto} disabled={full}>写真を撮る</PxButton>
          </div>
        </Window>
      )}

      <Window title="きょうのメモリー" as="section" aria-label="きょうのメモリー">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[15px]">
            撮った写真
            <InfoButton info={photosInfo} label="撮った写真について" />
          </p>
          <p className="text-[15px] text-(--px-yellow)" aria-label={`${MAX_PHOTOS_PER_DAY}枚のうち${props.photos.length}枚`}>
            <span className="px-pixel mr-1 text-[13px]">{props.photos.length} / {MAX_PHOTOS_PER_DAY}</span>枚
          </p>
        </div>
        <InfoNote info={photosInfo}>撮影は1日12枚までです。</InfoNote>
        {props.photos.length === 0 ? (
          <Tip className="mt-3">残したい瞬間を見つけたら、「写真を撮る」を押してください。</Tip>
        ) : (
          <Thumbs photos={props.photos} />
        )}

        <div className="mt-4 border-t-3 border-(--px-navy-3) pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px]">
              きょうのコイン
              <InfoButton info={coinsInfo} label="コインについて" />
            </p>
            <p className="px-pixel text-[14px] text-(--px-yellow)" aria-label={`${props.coins}枚`}>
              &times;{props.coins}
            </p>
          </div>
          <InfoNote info={coinsInfo}>
            <Sentences text="写真を撮るか、リマインダーをスキップすると、コインが1枚増えます。うすいコインは、まだ送れていない写真の分です。電波のよい場所で送れます。" />
          </InfoNote>
          {props.coins > 0 && (
            <div className="px-coins mt-3" aria-hidden="true">
              {Array.from({ length: Math.min(props.coins, MAX_COINS) }, (_, index) => (
                <PixelSprite key={index} name="coin" scale={2} className={index >= props.coins - props.unsentCoins ? "is-unsent" : undefined} />
              ))}
              {props.coins > MAX_COINS && <span className="px-pixel self-center text-[10px] text-(--px-ink-2)">+{props.coins - MAX_COINS}</span>}
            </div>
          )}
          {props.unsentCoins > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] text-(--px-ink-2)">未送信の写真 {props.unsentCoins}枚</p>
              <PxButton variant="secondary" size="sm" onClick={props.onResend} disabled={props.busy}>いま送る</PxButton>
            </div>
          )}
        </div>
      </Window>

      <div className="px-on-scene flex flex-col gap-2">
        <PxButton block size="lg" icon="camera" variant={props.pendingAt ? "secondary" : "primary"} onClick={props.onTakePhoto} disabled={full}>
          写真を撮る
        </PxButton>
        {full && (
          <p className="px-note px-note--float">
            <Sentences text="きょうは12枚撮りました。撮影は1日12枚までです。" />
          </p>
        )}
      </div>

      {reminderOn && props.plan ? (
        <ReminderOn plan={props.plan} nextPingAt={props.nextPingAt} now={props.now} />
      ) : (
        <Window title="リマインダー" as="section">
          <div className="space-y-3">
            {props.plan?.purpose === "accuracy" ? (
              <p className="text-[15px] leading-relaxed">
                <Sentences text={`いまは開発者向けの精度テストの通知（${props.plan.intervalMinutes}分ごと）がオンです。リマインダーに切り替えると、精度テストの通知は止まります。`} />
              </p>
            ) : (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[17px]">
                    いまはオフです
                    <InfoButton info={reminderInfo} label="リマインダーについて" />
                  </p>
                  <span className="px-chip px-chip--off">OFF</span>
                </div>
                <InfoNote info={reminderInfo}>
                  <Sentences text="オンにすると、15分か30分ごとに、撮影のきっかけを通知でお知らせします。通知は、その日の24時に止まります。" />
                </InfoNote>
              </div>
            )}
            {props.support !== "supported" ? (
              <InstallGuide support={props.support} />
            ) : props.photos.length === 0 ? (
              <p className="text-[14px] text-(--px-ink-2)">1枚撮ると、オンにできます。</p>
            ) : (
              <>
                <ReminderChoice busy={props.busy} onChoose={(interval) => void enable(interval)} />
                {reminderProblem && (
                  <p className="px-note" data-tone="warn" role="alert">
                    <Sentences text={reminderProblem} />
                  </p>
                )}
              </>
            )}
          </div>
        </Window>
      )}
    </>
  );
}

/** Today's photos as small squares, oldest first, read from the phone itself. */
function Thumbs({ photos }: { photos: LogEntry[] }) {
  return (
    <ul className="px-thumbs mt-3">
      {photos.map((entry) => (
        <li key={entry.id}>
          {entry.photo ? <BlobImage blob={entry.photo} alt={`${clock(entry.record.takenAt)} の写真`} /> : <span className="px-sr">{clock(entry.record.takenAt)} の写真</span>}
        </li>
      ))}
    </ul>
  );
}

/** The reminder while it is on: when the next one comes, and a gauge filling towards it. */
function ReminderOn({ plan, nextPingAt, now }: { plan: PushPlan; nextPingAt: number | null; now: number }) {
  if (nextPingAt === null) {
    return (
      <Window title="つぎのリマインダー" as="section">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[17px]">きょうのリマインダーは終わりました</p>
          <span className="px-chip">ON</span>
        </div>
      </Window>
    );
  }
  const left = remaining(nextPingAt - now);
  return (
    <Window title="つぎのリマインダー" as="section">
      <div className="flex items-end justify-between gap-3">
        <p className="px-digits" aria-label={`次のリマインダーは${clock(nextPingAt)}ごろ`}>{clock(nextPingAt)}</p>
        <div className="flex flex-col items-end gap-1 pb-1">
          <span className="px-chip">ON</span>
          <p className="text-[14px] text-(--px-ink-2)">{plan.intervalMinutes}分ごと</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Charge intervalMinutes={plan.intervalMinutes} nextPingAt={nextPingAt} now={now} />
        <p className="shrink-0 text-[14px] text-(--px-ink-2)">
          あと<span className="px-pixel ml-1.5 text-[12px] text-(--px-yellow)">{left.minutes}:{String(left.seconds).padStart(2, "0")}</span>
        </p>
      </div>
      <p className="mt-2 text-[14px] leading-relaxed text-(--px-ink-2)">
        <Sentences text="画面を消していても届きます。リマインダーはきょうの24時に止まります。" />
      </p>
    </Window>
  );
}

/** One cell per minute up to 15, per two minutes beyond; the one filling now blinks. */
function Charge({ intervalMinutes, nextPingAt, now }: { intervalMinutes: number; nextPingAt: number; now: number }) {
  const cells = intervalMinutes > 15 ? Math.ceil(intervalMinutes / 2) : intervalMinutes;
  const filled = Math.floor(((now - (nextPingAt - intervalMinutes * 60_000)) / (intervalMinutes * 60_000)) * cells);
  return (
    <div className="px-charge flex-1" style={{ gridTemplateColumns: `repeat(${cells}, 1fr)` }} aria-hidden="true">
      {Array.from({ length: cells }, (_, index) => (
        <i key={index} className={index < filled ? "is-full" : index === filled ? "is-filling" : undefined} />
      ))}
    </div>
  );
}
