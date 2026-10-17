"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { Consent } from "@/lib/ping-log/consent";
import type { PushSupport } from "@/lib/ping-log/environment";
import { preparePhoto } from "@/lib/ping-log/photo";
import { photoEntry, type Shot } from "@/lib/ping-log/photo-entry";
import type { PhotoMeta } from "@/lib/ping-log/record";
import type { LogEntry, SaveOutcome } from "@/lib/ping-log/store";
import { reducedMotion } from "@/lib/ray/fx";

import { useLayer } from "../layer";
import { clock } from "../ui";
import { Print, PrintPhoto, frameLabel, tearOne } from "./prints";
import { REMINDER_NOTE, useReminderSwitch } from "./screens";
import { ClearWord, DAY, Dock, Icon, NoteBar, Phrases, Screen, Seg, Sentences, SWAP, useField, useRay } from "./stage";

/**
 * A photo from the camera to the day's memory: a look at it, then
 * "メモリーに追加", then CLEAR!. Adding waits for the photo's one fix, then
 * the photo tears once and the screen flashes negative into the clear
 * screen. The screen never shows the place: that waits for the exhibition.
 */

type Props = {
  shot: Shot;
  consent: Consent;
  /** After the day's first photo while the reminder is off: its switch, once, on the clear screen. */
  offerReminder: boolean;
  support: PushSupport;
  reminderOn: boolean;
  busy: boolean;
  /** While the photo reminder is on. */
  nextReminderAt: number | null;
  inert: boolean;
  onRetake: () => void;
  onSave: (entry: LogEntry) => Promise<SaveOutcome>;
  /** Resolves to an error message, or null once the reminder is switched. */
  onReminder: (on: boolean) => Promise<string | null>;
  onInstall: () => void;
  onClose: () => void;
};

type Step = "preview" | "saving" | "done";

/** Only a photo still waiting is worth a word; a sent one needs none. */
const OUTCOME: Record<SaveOutcome, string> = {
  sent: "",
  queued: "まだ送信できていません。電波の良い場所で送信してください。",
  local: "",
};

export function PhotoScreen(props: Props) {
  const { shot } = props;
  const { field, fx, go } = useRay();
  const [photo, setPhoto] = useState<{ blob: Blob; meta: PhotoMeta } | null>(null);
  const [step, setStep] = useState<Step>("preview");
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [error, setError] = useState("");
  // Decided when the photo arrives, so switching it on here keeps the switch in view.
  const [offer] = useState(props.offerReminder);
  const close = useLayer("#photo", props.onClose);
  const photoRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const reminder = useReminderSwitch(props.reminderOn, props.support, props.onReminder, props.onInstall);
  useField("day", DAY);

  useEffect(() => {
    let alive = true;
    preparePhoto(shot.file, { exif: false }).then(
      (value) => {
        if (alive) setPhoto(value);
      },
      (problem: unknown) => {
        if (alive) setError(problem instanceof Error ? problem.message : "写真を読み込めませんでした。");
      },
    );
    return () => {
      alive = false;
    };
  }, [shot]);

  const ratio = photo && photo.meta.width > 0 && photo.meta.height > 0 ? photo.meta.width / photo.meta.height : 3 / 4;

  const add = async () => {
    if (!photo) return;
    setStep("saving");
    setError("");
    let saved: SaveOutcome;
    try {
      saved = await props.onSave(await photoEntry(shot, photo, props.consent));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "保存できませんでした。");
      setStep("preview");
      return;
    }
    navigator.vibrate?.(40);
    // The photo keeps its colours: it tears once, then the screen flashes negative to CLEAR!.
    if (!reducedMotion()) {
      await tearOne(photoRef.current?.querySelector("[data-print]") ?? null, 420, 1);
      void fx?.tear(300, 1);
      field?.burst(0.9);
      await fx?.flash(SWAP, 90);
    }
    setOutcome(saved);
    setStep("done");
  };

  if (step !== "done") {
    return (
      <Screen key="preview" inert={props.inert}>
        <div className="topbar">
          <span>
            <button type="button" className="link" disabled={step === "saving"} onClick={() => void go(close)}>
              <Icon name="close" />
              やめる
            </button>
          </span>
          <span className="mono">Photo</span>
          <span />
        </div>
        <h1 className="h1">
          <Phrases text="この写真を残しますか？" />
        </h1>
        <div ref={photoRef} className="preview__photo" style={{ ["--ratio" as string]: ratio }}>
          {photo ? (
            <PrintPhoto source={{ blob: photo.blob }} alt="撮った写真" />
          ) : (
            !error && (
              <p className="preview__wait mono mono--dim" role="status">
                Loading
              </p>
            )
          )}
        </div>
        <div className="preview__cap" style={{ ["--ratio" as string]: ratio }}>
          <span className="mono">{frameLabel(shot.number)}</span>
          <span className="mono">{clock(shot.receivedAt)}</span>
        </div>
        <div className="actionbar">
          <NoteBar text={error} alert />
          <button type="button" className="btn btn--line" disabled={step === "saving"} onClick={props.onRetake}>
            撮り直す
          </button>
          <button type="button" className="btn" disabled={!photo || step === "saving"} onClick={() => void add()}>
            {step === "saving" ? (
              "保存しています…"
            ) : (
              <>
                <Icon name="check" />
                メモリーに追加
              </>
            )}
          </button>
        </div>
      </Screen>
    );
  }

  const sub = `${outcome ? OUTCOME[outcome] : ""}`;
  return (
    <Screen key="clear" className="clear" inert={props.inert}>
      <div className="topbar">
        <span>
          <button type="button" className="link" onClick={() => void go(close)}>
            <Icon name="close" />
            閉じる
          </button>
        </span>
        <span className="mono">Clear</span>
        <span />
      </div>
      <ClearWord />
      {photo && (
        <div className="clear__print">
          <Print source={{ blob: photo.blob }} number={shot.number} time={clock(shot.receivedAt)} ratio={ratio} small />
        </div>
      )}
      <h1 className="h2 clear__msg" role="status">
        <Phrases text={`${shot.number}枚目のメモリーを残しました`} />
      </h1>
      {sub && (
        <p className="small clear__sub">
          <Sentences text={sub} />
        </p>
      )}
      {props.reminderOn && props.nextReminderAt !== null && (
        <p className="small clear__sub">
          次のリマインダーは <span className="latin">{clock(props.nextReminderAt)}</span> ごろです。
        </p>
      )}
      {offer && (
        <section className="clear__offer bracket" aria-labelledby={labelId}>
          <div className="kv">
            <p className="h3" id={labelId}>
              リマインダー
            </p>
            <Seg on={props.reminderOn} labelledBy={labelId} disabled={props.busy} onToggle={reminder.toggle} />
          </div>
          <p className="small" style={{ marginTop: 6 }}>
            <Sentences text={REMINDER_NOTE} />
          </p>
          {reminder.problem && (
            <p className="problem" role="alert">
              <Sentences text={reminder.problem} />
            </p>
          )}
        </section>
      )}
      {/* After the first photo the way home leads past the reminder's offer, so it stays in its place. */}
      <Dock sticky={!offer}>
        <button type="button" className="btn" onClick={() => void go(close)}>
          ホームへもどる
        </button>
      </Dock>
    </Screen>
  );
}
