"use client";

import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { lang, t } from "@/lib/i18n";
import { CONSENT_LEAD, CONSENT_SECTIONS, CONSENT_VERSION, consentInEnglish, type Consent } from "@/lib/ping-log/consent";
import type { EntryCheck, PushSupport } from "@/lib/ping-log/environment";
import { REMINDER_PLAN } from "@/lib/ping-log/push";
import type { LogEntry } from "@/lib/ping-log/store";

import { clock } from "../ui";
import { PhotoActions } from "./keepsake";
import { Print, Strip, frameLabel } from "./prints";
import { CampusWire } from "./wire";
import {
  ClearWord,
  DAY,
  Dock,
  Icon,
  Info,
  LightWindow,
  Mast,
  MastButtons,
  NoteBar,
  Phrases,
  Pop,
  Screen,
  Seg,
  Sentences,
  useField,
  useInfo,
  useNow,
} from "./stage";

/**
 * The participant's screens before arrival, on paper: the title, the
 * consent, home, the reminder that opened the page, and the skip's clear
 * screen. The photo's own screens are in photo.tsx, the menu's layers in
 * overlays.tsx, and arriving at ShibaLab in demo.tsx.
 */

/** What the install guide is called where this browser cannot receive notifications. */
export function installLabel(support: PushSupport): string {
  return support === "ios-browser" ? t("iPhone で通知を受け取るには", "Getting notifications on iPhone") : support === "in-app" ? t("アプリの中で開いています", "This page is open inside an app") : t("通知を受け取るには", "Getting notifications");
}

/* ------------------------------------------------------------------ title */

/**
 * Where the paper turns black: the foot of the title's upper part, in the
 * field's terms (0 at the bottom). The upper part gives way on a short phone
 * so the button stays in view, and the line moves with it.
 */
function useSplit(top: RefObject<HTMLElement | null>): number {
  const [split, setSplit] = useState(0.62);
  useLayoutEffect(() => {
    const box = top.current;
    const screen = box?.parentElement;
    if (!box || !screen) return;
    const measure = () => setSplit(Number((1 - box.offsetHeight / screen.clientHeight).toFixed(3)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(screen);
    observer.observe(box);
    return () => observer.disconnect();
  }, [top]);
  return split;
}

const entryStop = (): Partial<Record<EntryCheck, { head: string; text: string }>> => ({
  old: {
    head: t("この端末では参加できません", "This phone cannot join"),
    text: t("iOS 16.4 以降の iPhone と、Chrome 111 以降の Android で参加できます。展示は ShibaLab（教室棟301）で見られます。", "You can join with an iPhone on iOS 16.4 or later, or Android with Chrome 111 or later. You can still see the exhibit at ShibaLab (Classroom Building, Room 301)."),
  },
  "no-camera": {
    head: t("このブラウザでは参加できません", "This browser cannot join"),
    text: t("TRACE ではカメラで写真を撮ります。このブラウザではカメラを使えないので、Safari か Chrome で開いてください。", "TRACE uses the camera to take photos. This browser cannot use the camera, so please open the page in Safari or Chrome."),
  },
});

/**
 * The title's foot: 「はじめる」, or why this phone or browser cannot join and
 * what to do instead. In an iPhone's browser tab the button opens the
 * home-screen guide first, which lets the person join here all the same.
 */
function EntryCta({ entry, onStart, onInstall }: { entry: EntryCheck; onStart: () => void; onInstall: () => void }) {
  const stop = entryStop()[entry];
  if (stop) {
    return (
      <div className="title__cta">
        <div className="title__stop">
          <h2>{stop.head}</h2>
          <p>
            <Sentences text={stop.text} />
          </p>
        </div>
      </div>
    );
  }
  const inApp = entry === "in-app";
  return (
    <div className="title__cta">
      {inApp && (
        <p className="title__why">
          <Sentences text={t("LINE などのアプリの中で開いたページでは参加できません。Safari か Chrome で開いてください。", "You cannot join from a page opened inside an app such as LINE. Please open it in Safari or Chrome.")} />
        </p>
      )}
      <button type="button" className="btn" disabled={inApp} onClick={entry === "ios-browser" ? onInstall : onStart}>
        {t("はじめる", "Start")}
        <Icon name="arrow" />
      </button>
      {inApp && (
        <p className="title__more">
          <button type="button" className="link" onClick={onInstall}>
            {t("Safari か Chrome で開くには", "How to open in Safari or Chrome")}
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * The title fits on one screen without scrolling: the black below the line
 * is the field's, fixed behind the page, and TRACE has to stay on the line.
 */
export function TitleScreen({
  notes,
  foot,
  inert,
  onDeveloper,
  onMenu,
}: {
  notes: string[];
  /**
   * 「はじめる」, or for someone already taking part, back here from the TRACE
   * mark, the way home: how to play and the consent would join a second
   * time, and this browser is not checked again.
   */
  foot: { entry: EntryCheck; onStart: () => void; onInstall: () => void } | { onHome: () => void };
  inert: boolean;
  onDeveloper: () => void;
  onMenu: () => void;
}) {
  const top = useRef<HTMLDivElement>(null);
  const split = useSplit(top);
  // One beam comes down from the upper right, clear of the text, and lands just past the line where the paper turns black.
  useField(
    "day",
    { scene: 1, splitOn: 1, splitY: split, invert: 0, beamA: [1.05, 0.95], beamB: [0.87, split - 0.012], beam: 1, grow: 1, flow: 3, pool: 1, poolAt: 1, poolR: [0.075, 0.02] },
    "title",
  );

  return (
    <Screen className="title" inert={inert}>
      <div className="title__top" ref={top}>
        <div className="ghost" aria-hidden="true">
          RAY
        </div>
        <div className="title__meta">
          <p className="mono">
            54th Shibaura Festival
            <br />
            <span className="keep-case">ShibaLab</span> 301 / Ray
          </p>
          <MastButtons onDeveloper={onDeveloper} onMenu={onMenu} />
        </div>
      </div>
      <div className="title__bottom">
        <h1 className="title__word">TRACE</h1>
        {notes.map((note) => (
          <NoteBar key={note} text={note} />
        ))}
        <p className="title__tag">
          ShibaLab <span>{t("体験型メディアアート作品", "Interactive media art")}</span>
        </p>
        <p className="title__lead">
          <Sentences text={t("学祭で残したい瞬間を、写真に撮ってください。", "Take photos of the festival moments you want to keep.")} />
        </p>
        <ol className="steps" aria-label={t("参加の流れ", "How it works")}>
          <li>
            <span className="mono">1</span>{t("芝浦祭を楽しむ", "Enjoy the festival")}
          </li>
          <li>
            <span className="mono">2</span>{t("写真を撮る", "Take photos")}
          </li>
          <li>
            <span className="mono">3</span>
            <Phrases text={t("ShibaLab に行く", "Visit ShibaLab")} />
          </li>
        </ol>
        <CampusWire />
        {"onHome" in foot ? (
          <div className="title__cta">
            <button type="button" className="btn" onClick={foot.onHome}>
              {t("ホームへもどる", "Back to home")}
            </button>
          </div>
        ) : (
          <EntryCta {...foot} />
        )}
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------------- consent */

/**
 * In English, a translation for reading above TRACE_B's Japanese text, which
 * stays the text agreed to. A version without a translation says so.
 */
function EnglishTerms({ version }: { version: string }) {
  const english = consentInEnglish(version);
  return (
    <section className="sec" lang="en">
      <p className="small">
        {english
          ? "English translation for reference. The Japanese text below is the official version you agree to."
          : "There is no English translation of this version yet. The Japanese text below is the official version you agree to. Please ask the staff at the ASYNC booth (Classroom Building, Room 301) if you have questions."}
      </p>
      {english && <p className="body" style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{english}</p>}
    </section>
  );
}

/** The consent text. Before joining it ends in the two answers; from the menu, in a close button. */
export function ConsentBody({ terms, answer, onClose }: { terms: Pick<Consent, "version" | "body" | "language"> | null; answer?: { busy: boolean; error: string; onAgree: () => void }; onClose: () => void }) {
  return (
    <>
      <div className="topbar">
        <span className="mono">Consent</span>
        <span />
        <span>
          {!answer && (
            <button type="button" className="icon-btn" aria-label={t("閉じる", "Close")} onClick={onClose}>
              <Icon name="close" />
            </button>
          )}
        </span>
      </div>
      <h1 className="h1 consent__head">
        <Phrases text={t("参加の前に読んでください", "Please read before joining")} />
      </h1>
      {terms?.body ? (
        <>
        {lang() === "en" && terms.language !== "en" && <EnglishTerms version={terms.version} />}
        <section className="sec" lang={terms.language}>
          <p className="mono">{terms.version}</p>
          <p className="body" style={{ whiteSpace: "pre-wrap" }}>{terms.body}</p>
        </section>
        </>
      ) : terms?.version === CONSENT_VERSION && !answer ? (
        <>
      <p className="body consent__lead">
        <Sentences text={CONSENT_LEAD} />
      </p>
      {CONSENT_SECTIONS.map((section) => (
        <section key={section.title} className="sec">
          <h2 className="h3">{section.title}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item}>
                <Sentences text={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
        </>
      ) : (
        <p className="body">{terms ? t(`同意した説明の版: ${terms.version}。この端末には本文が保存されていません。`, `You agreed to version ${terms.version}. Its text is not saved on this phone.`) : t("参加の説明を取得できていません。通信を確認して、説明を読み込んでください。", "The information about taking part has not loaded. Check your connection and load it again.")}</p>
      )}
      <div className="dock">
        {answer ? (
          <>
            <NoteBar text={answer.error} alert />
            <div className="btns">
              <button type="button" className="btn" disabled={answer.busy} onClick={answer.onAgree}>
                {answer.busy ? t("通信しています…", "Connecting…") : terms?.body ? t("同意して参加する", "Agree and join") : t("説明を読み込む", "Load the information")}
              </button>
              <button type="button" className="btn btn--line" disabled={answer.busy} onClick={onClose}>
                {t("同意しない", "Do not agree")}
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn btn--line" onClick={onClose}>
            {t("閉じる", "Close")}
          </button>
        )}
      </div>
    </>
  );
}

export function ConsentScreen({ terms, busy, error, inert, onAgree, onDecline }: { terms: Pick<Consent, "version" | "body" | "language"> | null; busy: boolean; error: string; inert: boolean; onAgree: () => void; onDecline: () => void }) {
  useField("day", DAY);
  return (
    <Screen className="screen--read" inert={inert}>
      <ConsentBody terms={terms} answer={{ busy, error, onAgree }} onClose={onDecline} />
    </Screen>
  );
}

/* ------------------------------------------------------------------- home */

/**
 * The reminder's switch: where this browser cannot receive notifications, the
 * tap opens the way to one that can. `settle` shows another change's problem
 * (the interval's) in the same place.
 */
export function useReminderSwitch(on: boolean, support: PushSupport, onChange: (on: boolean) => Promise<string | null>, onInstall: () => void) {
  const [problem, setProblem] = useState("");
  const settle = async (change: () => Promise<string | null>) => {
    setProblem("");
    setProblem((await change()) ?? "");
  };
  const toggle = async () => {
    if (!on && support !== "supported") {
      onInstall();
      return;
    }
    await settle(() => onChange(!on));
  };
  return { problem, toggle: () => void toggle(), settle: (change: () => Promise<string | null>) => void settle(change) };
}

/**
 * How the reminder runs: how often, what else may be chosen while it is on,
 * and when it stops by itself. Through the push worker it is every 30
 * minutes until midnight; through TRACE_B, as its config allows, until arrival.
 */
export type ReminderTerms = { intervalMinutes: number; choices: number[]; stops: "midnight" | "arrival" };

export const WORKER_REMINDER: ReminderTerms = { intervalMinutes: REMINDER_PLAN.intervalMinutes, choices: [], stops: "midnight" };

export function reminderNote({ intervalMinutes, stops }: ReminderTerms): string {
  const often = t(`オンにすると、${intervalMinutes}分ごとに撮影のリマインダーが届きます。`, `When it is on, you get a reminder to take a photo every ${intervalMinutes} minutes. `);
  return stops === "midnight"
    ? `${often}${t("リマインダーは、オンにした日の24時に止まります。", "It stops at midnight on the day you turned it on.")}`
    : `${often}${t("リマインダーは、ShibaLab で QR コードを読み取ったときか、参加の期限が来たときに止まります。", "It stops when you scan the QR code at ShibaLab, or when your participation period ends.")}`;
}

/** The interval, among what TRACE_B allows: the chosen one inverts, as on the switch. */
function IntervalSeg(props: { value: number; choices: number[]; labelledBy: string; disabled: boolean; onChoose: (minutes: number) => void }) {
  return (
    <div className="seg" role="group" aria-labelledby={props.labelledBy} style={{ gridTemplateColumns: `repeat(${props.choices.length}, 1fr)` }}>
      {props.choices.map((minutes) => (
        <button
          key={minutes}
          type="button"
          className={`seg__o${minutes === props.value ? " is-on" : ""}`}
          aria-pressed={minutes === props.value}
          disabled={props.disabled}
          onClick={() => minutes !== props.value && props.onChoose(minutes)}
        >
          {t(`${minutes}分`, `${minutes} min`)}
        </button>
      ))}
    </div>
  );
}

type HomeProps = {
  /** This participation's photos, oldest first. */
  photos: LogEntry[];
  ended: boolean;
  maxPhotos: number;
  /** A reminder waiting for an answer. */
  pendingAt: string | null;
  reminderOn: boolean;
  nextReminderAt: number | null;
  reminderTerms: ReminderTerms;
  support: PushSupport;
  busy: boolean;
  message: string;
  inert: boolean;
  onTakePhoto: () => void;
  onSkip: () => void;
  onReminder: (on: boolean) => Promise<string | null>;
  /** Resolves to an error message, or null once the interval is changed. */
  onReminderInterval: (minutes: number) => Promise<string | null>;
  /** TRACE_B has the arrival: the foot leads to the keepsake instead of the QR code. */
  arrived: boolean;
  /** Asks before deleting a photo (#51). */
  onDelete: (entry: LogEntry, number: number) => void;
  onArrive: () => void;
  onDeveloper: () => void;
  onMenu: () => void;
  onInstall: () => void;
  onTitle: () => void;
};

/**
 * Home, where a participant lands every time after joining: a reminder
 * waiting for an answer, today's photos shown large under a ruled head, each
 * of which can be saved to the phone or deleted, the camera button, the reminder's
 * switch, and at the foot, in the dark of the room, the way into ShibaLab.
 * Nothing here mentions where photos were taken.
 */
export function HomeScreen(props: HomeProps) {
  const { photos, maxPhotos, pendingAt } = props;
  const memoryInfo = useInfo();
  const reminderInfo = useInfo();
  const labelId = useId();
  const reminder = useReminderSwitch(props.reminderOn, props.support, props.onReminder, props.onInstall);
  const count = photos.length;
  const left = maxPhotos - count;
  const full = left <= 0;
  const now = useNow(15_000);
  useField("day", DAY);

  return (
    <Screen className="home" inert={props.inert}>
      <Mast onTitle={props.onTitle} onDeveloper={props.onDeveloper} onMenu={props.onMenu} />
      <NoteBar text={props.message} />

      {pendingAt && (
        <section className="ping inv" aria-labelledby={`${labelId}-ping`}>
          <div className="ping__top">
            <span className="mono">
              <span className="blink">!</span> Reminder
            </span>
            <span className="mono">{clock(pendingAt)}</span>
          </div>
          <p className="h3" id={`${labelId}-ping`}>
            {t("撮影のリマインダー", "Photo reminder")}
          </p>
          <p className="body">
            <Sentences text={t(`${clock(pendingAt)} のリマインダーです。残したい景色があれば、写真を撮ってみませんか。`, `Your ${clock(pendingAt)} reminder. If there is a scene you want to keep, take a photo.`)} />
          </p>
          <div className="btns btns--2" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn--line" onClick={props.onSkip}>
              {t("スキップ", "Skip")}
            </button>
            <button type="button" className="btn" disabled={full || props.ended} onClick={props.onTakePhoto}>
              {t("写真を撮る", "Take a photo")}
            </button>
          </div>
        </section>
      )}

      <header className="home__head">
        <p className="home__meta mono">
          <span>Photos</span>
          <span aria-hidden="true">
            {count} / {maxPhotos}
          </span>
          <span className="sr-only">{t(`${count}枚（${maxPhotos}枚まで）`, `${count} photos (up to ${maxPhotos})`)}</span>
        </p>
        <h1 className="h1 home__title">
          {t("撮った写真", "Your photos")}
          <Info info={memoryInfo} label={t("撮った写真について", "About your photos")} />
        </h1>
      </header>
      <Pop info={memoryInfo} text={t(`撮影は${maxPhotos}枚までです。`, `You can take up to ${maxPhotos} photos.`)} />
      {!props.ended && left > 0 && left <= 3 && <p className="h3 remain">{t(`あと${left}枚撮れます`, left === 1 ? "1 photo left" : `${left} photos left`)}</p>}

      {count === 0 ? (
        <div className="slot">
          <LightWindow className="empty" />
          <div className="print__cap" aria-hidden="true">
            <span>{frameLabel(1)}</span>
            <span>{clock(now)}</span>
          </div>
        </div>
      ) : (
        <Strip label={t("撮った写真（新しい順）", "Your photos (newest first)")} one={count === 1}>
          {[...photos].reverse().map((entry, index) => {
            const meta = entry.record.photo;
            return (
              <li key={entry.id}>
                <Print
                  source={entry.photo ? { blob: entry.photo } : { src: "" }}
                  number={count - index}
                  time={clock(entry.record.takenAt)}
                  ratio={meta && meta.width > 0 && meta.height > 0 ? meta.width / meta.height : 3 / 4}
                />
                <PhotoActions entry={entry} number={count - index} onDelete={props.onDelete} />
              </li>
            );
          })}
        </Strip>
      )}

      {/* The button follows a scroll, unless a reminder above has its own. */}
      <Dock sticky={!pendingAt && !full}>
        <button type="button" className={`btn${pendingAt ? " btn--line" : ""}`} disabled={full || props.ended} onClick={props.onTakePhoto}>
          <Icon name="camera" />
          {t("写真を撮る", "Take a photo")}
        </button>
      </Dock>
      {props.ended && <p className="note-bar" role="status">{t("参加は終了しました。保存期限までは写真の確認と記録の削除ができます。", "Your participation has ended. Until the storage period ends, you can view your photos and delete your records.")}</p>}
      {full && (
        <p className="small limit">
          <Sentences text={t(`${maxPhotos}枚撮り終えました。新しく撮るときは、写真を1枚削除してください。`, `You have taken all ${maxPhotos} photos. To take a new one, delete a photo first.`)} />
        </p>
      )}

      <div className="row-reminder">
        <div>
          <p className="h3">
            <span id={labelId}>{t("リマインダー", "Reminder")}</span>
            <Info info={reminderInfo} label={t("リマインダーについて", "About the reminder")} />
          </p>
          {props.reminderOn && props.nextReminderAt !== null && (
            <p className="small next">
              {t("次は ", "Next at about ")}<span className="latin">{clock(props.nextReminderAt)}</span>{t(" ごろです。", ".")}
            </p>
          )}
        </div>
        <Seg on={props.reminderOn} labelledBy={labelId} disabled={props.busy || props.ended} onToggle={reminder.toggle} />
      </div>
      <Pop info={reminderInfo} text={reminderNote(props.reminderTerms)} />
      {props.reminderOn && props.reminderTerms.choices.length > 1 && (
        <div className="kv row-interval">
          <p className="small" id={`${labelId}-interval`}>
            {t("届く間隔", "Every")}
          </p>
          <IntervalSeg
            value={props.reminderTerms.intervalMinutes}
            choices={props.reminderTerms.choices}
            labelledBy={`${labelId}-interval`}
            disabled={props.busy}
            onChoose={(minutes) => reminder.settle(() => props.onReminderInterval(minutes))}
          />
        </div>
      )}
      {reminder.problem && (
        <p className="problem" role="alert">
          <Sentences text={reminder.problem} />
        </p>
      )}
      {props.support !== "supported" && (
        <p className="small ios-link">
          <button type="button" className="link" onClick={props.onInstall}>
            {installLabel(props.support)}
          </button>
        </p>
      )}

      <section className="home__lab ink" aria-label="ShibaLab">
        <p className="home__room" aria-hidden="true">
          301
        </p>
        <div className="lab__head">
          <span className="mono keep-case">ShibaLab</span>
          <span className="mono">Room 301</span>
        </div>
        {props.ended && !props.arrived ? (
          <p className="body">{t("参加は終了しました。残した写真はこの画面で確認できます。", "Your participation has ended. You can see your photos on this screen.")}</p>
        ) : props.arrived ? (
          <>
            <p className="body">
              <Sentences text={props.ended ? t("参加は終了しました。残した写真を確認できます。", "Your participation has ended. You can see your photos.") : t("再生が終わったら、撮った写真を一枚の作品にして保存できます。", "After the playback, you can save your photos as one artwork.")} />
            </p>
            <button type="button" className="btn" onClick={props.onArrive}>
              <Icon name="arrow" />
              {t("作品を見る", "See your artwork")}
            </button>
          </>
        ) : (
          <>
            <p className="body">
              <Sentences text={t("お帰りの前に、ぜひ ShibaLab（教室棟301）にご来場ください。展示場にある QR コードを読み取ると、あなたの今日の一日を振り返れます。", "Before you leave, please visit ShibaLab (Classroom Building, Room 301). Scan the QR code at the exhibit to look back on your day.")} />
            </p>
            <button type="button" className="btn" onClick={props.onArrive}>
              <Icon name="qr" />
              {t("QR コードを読み取る", "Scan the QR code")}
            </button>
          </>
        )}
      </section>
    </Screen>
  );
}

/* ------------------------------------------------------------------- ping */

/** Opened from a reminder's notification: the time, the question, and a window of light. */
export function PingScreen({ pendingAt, full, inert, onTakePhoto, onSkip, onClose }: { pendingAt: string; full: boolean; inert: boolean; onTakePhoto: () => void; onSkip: () => void; onClose: () => void }) {
  useField("day", DAY);
  return (
    <Screen className="screen--flex pingscreen" inert={inert}>
      <div className="topbar">
        <span>
          <button type="button" className="link" onClick={onClose}>
            <Icon name="close" />
            {t("閉じる", "Close")}
          </button>
        </span>
        <span className="mono">
          <span className="blink">!</span> Reminder
        </span>
        <span />
      </div>
      <p className="pingscreen__clock">{clock(pendingAt)}</p>
      <h1 className="h2">
        <Sentences text={t(`${clock(pendingAt)} のリマインダーです。残したい景色があれば、写真を撮ってみませんか。`, `Your ${clock(pendingAt)} reminder. If there is a scene you want to keep, take a photo.`)} />
      </h1>
      <LightWindow className="pingscreen__fill" soft={18} sweep />
      <div className="btns">
        <button type="button" className="btn" disabled={full} onClick={onTakePhoto}>
          <Icon name="camera" />
          {t("写真を撮る", "Take a photo")}
        </button>
        <button type="button" className="btn btn--line" onClick={onSkip}>
          {t("スキップ", "Skip")}
        </button>
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------- skip */

/** The reminder skipped: CLEAR! all the same, with a frame of light where the photo would be. */
export function SkipScreen({ at, nextReminderAt, inert, onClose }: { at: string; nextReminderAt: number | null; inert: boolean; onClose: () => void }) {
  useField("day", DAY);
  return (
    <Screen className="clear" inert={inert}>
      <div className="topbar">
        <span />
        <span className="mono">Clear</span>
        <span />
      </div>
      <ClearWord />
      <div className="skip__frame" aria-hidden="true">
        <LightWindow className="skip__win" />
        <div className="print__cap">
          <span>SKIP</span>
          <span>{clock(at)}</span>
        </div>
      </div>
      <h1 className="h2 clear__msg" role="status">
        <Phrases text={t("今回はスキップしました", "Skipped this time")} />
      </h1>
      <p className="body clear__sub">
        <Sentences text={t("撮りたいものがあるときだけ撮れば十分です。", "Only take a photo when there is something you want to keep.")} />
      </p>
      {nextReminderAt !== null && (
        <p className="small clear__sub">
          {t("次のリマインダーは ", "Next reminder at about ")}<span className="latin">{clock(nextReminderAt)}</span>{t(" ごろです。", ".")}
        </p>
      )}
      <button type="button" className="btn" onClick={onClose}>
        {t("ホームへもどる", "Back to home")}
      </button>
    </Screen>
  );
}
