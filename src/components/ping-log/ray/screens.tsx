"use client";

import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { CONSENT_LEAD, CONSENT_SECTIONS } from "@/lib/ping-log/consent";
import type { PushSupport } from "@/lib/ping-log/environment";
import { REMINDER_PLAN } from "@/lib/ping-log/push";
import type { LogEntry } from "@/lib/ping-log/store";

import { clock } from "../ui";
import { Print, Strip, frameLabel } from "./prints";
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
  return support === "ios-browser" ? "iPhone で通知を受け取るには" : support === "in-app" ? "アプリの中で開いています" : "通知を受け取るには";
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

/**
 * The title fits on one screen without scrolling: the black below the line
 * is the field's, fixed behind the page, and TRACE has to stay on the line.
 */
export function TitleScreen({
  notes,
  inert,
  onStart,
  onDeveloper,
  onMenu,
}: {
  notes: string[];
  inert: boolean;
  onStart: () => void;
  onDeveloper: () => void;
  onMenu: () => void;
}) {
  const info = useInfo();
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
            ShibaLab 301 / Ray
          </p>
          <MastButtons onDeveloper={onDeveloper} onMenu={onMenu} />
        </div>
      </div>
      <div className="title__bottom">
        <h1 className="title__word">TRACE</h1>
        {notes.map((note) => (
          <NoteBar key={note} text={note} />
        ))}
        <p className="title__tag">写真で残す、学祭の一日</p>
        <p className="title__lead">
          <Sentences text="学祭で残したい瞬間を、写真に撮ってください。撮った写真は、あなたの一日のメモリーになります。" />
        </p>
        <ol className="steps" aria-label="参加の流れ">
          <li>
            <span className="mono">1</span>写真を撮る
          </li>
          <li>
            <span className="mono">2</span>学祭をめぐる
          </li>
          <li>
            <span className="mono">3</span>ShibaLab&nbsp;へ
          </li>
        </ol>
        <p className="title__note">
          <Phrases text="ShibaLab（教室棟301）には、好きなときに来てください。" />
          <Info info={info} label="写真の扱いについて" />
        </p>
        <Pop info={info} text="撮った写真は、展示に出しません。参加は任意です。" />
        <div className="title__cta">
          <button type="button" className="btn" onClick={onStart}>
            はじめる
            <Icon name="arrow" />
          </button>
        </div>
      </div>
    </Screen>
  );
}

/* ---------------------------------------------------------------- consent */

/** The consent text. Before joining it ends in the two answers; from the menu, in a close button. */
export function ConsentBody({ answer, onClose }: { answer?: { busy: boolean; error: string; onAgree: () => void }; onClose: () => void }) {
  return (
    <>
      <div className="topbar">
        <span className="mono">Consent</span>
        <span />
        <span>
          {!answer && (
            <button type="button" className="icon-btn" aria-label="閉じる" onClick={onClose}>
              <Icon name="close" />
            </button>
          )}
        </span>
      </div>
      <h1 className="h1 consent__head">
        <Phrases text="参加の前に読んでください" />
      </h1>
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
      <div className="dock">
        {answer ? (
          <>
            <NoteBar text={answer.error} alert />
            <div className="btns">
              <button type="button" className="btn" disabled={answer.busy} onClick={answer.onAgree}>
                {answer.busy ? "参加しています…" : "同意して参加する"}
              </button>
              <button type="button" className="btn btn--line" disabled={answer.busy} onClick={onClose}>
                同意しない
              </button>
            </div>
            <p className="small">
              <Sentences text="カメラなどの許可は、はじめて撮影するときに求めます。" />
            </p>
          </>
        ) : (
          <button type="button" className="btn btn--line" onClick={onClose}>
            閉じる
          </button>
        )}
      </div>
    </>
  );
}

export function ConsentScreen({ busy, error, inert, onAgree, onDecline }: { busy: boolean; error: string; inert: boolean; onAgree: () => void; onDecline: () => void }) {
  useField("day", DAY);
  return (
    <Screen className="screen--read" inert={inert}>
      <ConsentBody answer={{ busy, error, onAgree }} onClose={onDecline} />
    </Screen>
  );
}

/* ------------------------------------------------------------------- home */

/** The reminder's switch: where this browser cannot receive notifications, the tap opens the way to one that can. */
export function useReminderSwitch(on: boolean, support: PushSupport, onChange: (on: boolean) => Promise<string | null>, onInstall: () => void) {
  const [problem, setProblem] = useState("");
  const toggle = async () => {
    if (!on && support !== "supported") {
      onInstall();
      return;
    }
    setProblem("");
    setProblem((await onChange(!on)) ?? "");
  };
  return { problem, toggle: () => void toggle() };
}

export const REMINDER_NOTE = `オンにすると、${REMINDER_PLAN.intervalMinutes}分ごとに撮影のリマインダーが届きます。リマインダーは、オンにした日の24時に止まります。`;

type HomeProps = {
  /** This participation's photos, oldest first. */
  photos: LogEntry[];
  maxPhotos: number;
  /** A reminder waiting for an answer. */
  pendingAt: string | null;
  reminderOn: boolean;
  nextReminderAt: number | null;
  support: PushSupport;
  busy: boolean;
  message: string;
  inert: boolean;
  onTakePhoto: () => void;
  onSkip: () => void;
  onReminder: (on: boolean) => Promise<string | null>;
  onResend: () => void;
  onArrive: () => void;
  onDeveloper: () => void;
  onMenu: () => void;
  onInstall: () => void;
};

/**
 * Home, where a participant lands every time after joining: a reminder
 * waiting for an answer, today's photos shown large under a ruled head, the
 * camera button, the reminder's switch, and at the foot, in the dark of the
 * room, the way into ShibaLab. Nothing here mentions where photos were taken.
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
  const unsent = photos.filter((entry) => !entry.sentAt).length;
  const now = useNow(15_000);
  useField("day", DAY);

  return (
    <Screen className="home" inert={props.inert}>
      <Mast onDeveloper={props.onDeveloper} onMenu={props.onMenu} />
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
            撮影のリマインダー
          </p>
          <p className="body">
            <Sentences text={`${clock(pendingAt)} のリマインダーです。残したい景色があれば、写真を撮ってみませんか。`} />
          </p>
          <div className="btns btns--2" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn--line" onClick={props.onSkip}>
              スキップ
            </button>
            <button type="button" className="btn" disabled={full} onClick={props.onTakePhoto}>
              写真を撮る
            </button>
          </div>
        </section>
      )}

      <header className="home__head">
        <p className="home__meta mono">
          <span>Memory</span>
          <span aria-hidden="true">
            {String(count).padStart(2, "0")} / {maxPhotos}
          </span>
          <span className="sr-only">{`${count}枚（${maxPhotos}枚まで）`}</span>
        </p>
        <h1 className="h1 home__title">
          きょうのメモリー
          <Info info={memoryInfo} label="きょうのメモリーについて" />
        </h1>
        {count === 0 && (
          <p className="body home__lead">
            <Sentences text="残したい瞬間を見つけたら、撮ってください。" />
          </p>
        )}
      </header>
      <Pop info={memoryInfo} text={`撮影は${maxPhotos}枚までです。送信できていない写真は、電波の良い場所で送信してください。`} />
      {unsent > 0 && (
        <div className="unsent">
          <span className="body">
            <b>未送信</b> {unsent}枚
          </span>
          <button type="button" className="link" disabled={props.busy} onClick={props.onResend}>
            いま送る
          </button>
        </div>
      )}
      {left > 0 && left <= 3 && <p className="h3 remain">あと{left}枚撮れます</p>}

      {count === 0 ? (
        <div className="slot">
          <LightWindow className="empty" />
          <div className="print__cap" aria-hidden="true">
            <span>{frameLabel(1)}</span>
            <span>{clock(now)}</span>
          </div>
        </div>
      ) : (
        <Strip label="きょうの写真（新しい順）" one={count === 1}>
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
              </li>
            );
          })}
        </Strip>
      )}

      {/* The button follows a scroll, unless a reminder above has its own. */}
      <Dock sticky={!pendingAt && !full}>
        <button type="button" className={`btn${pendingAt ? " btn--line" : ""}`} disabled={full} onClick={props.onTakePhoto}>
          <Icon name="camera" />
          写真を撮る
        </button>
      </Dock>
      {full && (
        <p className="small limit">
          <Sentences text={`${maxPhotos}枚撮り終えました。撮影は${maxPhotos}枚までです。`} />
        </p>
      )}

      <div className="row-reminder">
        <div>
          <p className="h3">
            <span id={labelId}>リマインダー</span>
            <Info info={reminderInfo} label="リマインダーについて" />
          </p>
          {props.reminderOn && props.nextReminderAt !== null && (
            <p className="small next">
              次は <span className="latin">{clock(props.nextReminderAt)}</span> ごろです。
            </p>
          )}
        </div>
        <Seg on={props.reminderOn} labelledBy={labelId} disabled={props.busy} onToggle={reminder.toggle} />
      </div>
      <Pop info={reminderInfo} text={REMINDER_NOTE} />
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
          <span className="mono">ShibaLab</span>
          <span className="mono">Room 301</span>
        </div>
        <p className="body">
          <Sentences text="ShibaLab（教室棟301）には、好きなときに来てください。着いたら、ASYNC のブースにある QR コードを読み取ってください。" />
        </p>
        <button type="button" className="btn" onClick={props.onArrive}>
          <Icon name="qr" />
          QR コードを読み取る
        </button>
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
            閉じる
          </button>
        </span>
        <span className="mono">
          <span className="blink">!</span> Reminder
        </span>
        <span />
      </div>
      <p className="pingscreen__clock">{clock(pendingAt)}</p>
      <h1 className="h2">
        <Sentences text={`${clock(pendingAt)} のリマインダーです。残したい景色があれば、写真を撮ってみませんか。`} />
      </h1>
      <LightWindow className="pingscreen__fill" soft={18} sweep />
      <div className="btns">
        <button type="button" className="btn" disabled={full} onClick={onTakePhoto}>
          <Icon name="camera" />
          写真を撮る
        </button>
        <button type="button" className="btn btn--line" onClick={onSkip}>
          スキップ
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
        <Phrases text="今回はスキップしました" />
      </h1>
      <p className="body clear__sub">
        <Sentences text="撮りたいものがあるときだけ撮れば十分です。" />
      </p>
      {nextReminderAt !== null && (
        <p className="small clear__sub">
          次のリマインダーは <span className="latin">{clock(nextReminderAt)}</span> ごろです。
        </p>
      )}
      <button type="button" className="btn" onClick={onClose}>
        ホームへもどる
      </button>
    </Screen>
  );
}
