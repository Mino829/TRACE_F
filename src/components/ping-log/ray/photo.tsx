"use client";

import { useEffect, useId, useRef, useState } from "react";

import { PlacePicker } from "@/components/place-picker/place-picker";
import type { Consent } from "@/lib/ping-log/consent";
import type { PushSupport } from "@/lib/ping-log/environment";
import { preparePhoto } from "@/lib/ping-log/photo";
import { photoEntry, type Shot } from "@/lib/ping-log/photo-entry";
import type { PhotoMeta } from "@/lib/ping-log/record";
import type { LogEntry, SaveOutcome } from "@/lib/ping-log/store";
import { PLACES } from "@/lib/places/places";
import type { PhotoPlace } from "@/lib/places/types";
import { reducedMotion } from "@/lib/ray/fx";

import { useLayer } from "../layer";
import { clock } from "../ui";
import { Print, PrintPhoto, frameLabel, tearOne } from "./prints";
import { useReminderSwitch, type ReminderTerms } from "./screens";
import { ClearWord, DAY, Dock, Icon, Info, NoteBar, Phrases, Pop, Screen, Seg, Sentences, SWAP, useField, useInfo, useRay } from "./stage";

/**
 * A photo from the camera to the day's memory: a look at it, the choice of
 * the checkpoint it was taken at (place-picker), then CLEAR!. Saving tears
 * the photo once and flashes the screen negative into the clear screen. The
 * phone's position is never read: the place is the participant's own word.
 */

type Props = {
  shot: Shot;
  consent: Consent;
  /** After the day's first photo while the reminder is off: its switch, once, on the clear screen. */
  offerReminder: boolean;
  /** The place chosen for the photo before this one, where the picker opens. */
  lastPlace: PhotoPlace | null;
  maxPhotos: number;
  support: PushSupport;
  reminderOn: boolean;
  reminderTerms: ReminderTerms;
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

type Step = "preview" | "place" | "saving" | "done";

export function PhotoScreen(props: Props) {
  const { shot } = props;
  const { field, fx, go } = useRay();
  const [photo, setPhoto] = useState<{ blob: Blob; meta: PhotoMeta } | null>(null);
  const [step, setStep] = useState<Step>("preview");
  const [error, setError] = useState("");
  // Decided when the photo arrives, so switching it on here keeps the switch in view.
  const [offer] = useState(props.offerReminder);
  // The phone's back button steps back inside the flow (place -> photo) instead of dropping the photo; while saving it waits.
  const close = useLayer("#photo", () => {
    if (step === "place" || step === "saving") {
      window.history.pushState(null, "", "#photo");
      if (step === "place") {
        setError("");
        setStep("preview");
      }
      return;
    }
    props.onClose();
  });
  const photoRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const reminderInfo = useInfo();
  const reminder = useReminderSwitch(props.reminderOn, props.support, props.onReminder, props.onInstall);
  useField("day", DAY);

  useEffect(() => {
    let alive = true;
    preparePhoto(shot.file).then(
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

  const add = async (place: PhotoPlace) => {
    if (!photo) return;
    setStep("saving");
    setError("");
    try {
      // The photo stays on the phone (#54): there is nothing to wait for on the network.
      await props.onSave(await photoEntry(shot, photo, props.consent, place));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "保存できませんでした。");
      setStep("place");
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
    setStep("done");
  };

  if (step === "place" || step === "saving") {
    return (
      <PlacePicker
        data={PLACES}
        photo={photo?.blob ?? null}
        last={props.lastPlace}
        number={shot.number}
        maxPhotos={props.maxPhotos}
        saving={step === "saving"}
        error={error}
        inert={props.inert}
        onBack={() => {
          setError("");
          setStep("preview");
        }}
        onConfirm={(place) => void add(place)}
      />
    );
  }

  if (step !== "done") {
    return (
      <Screen key="preview" inert={props.inert}>
        <div className="topbar">
          <span>
            <button type="button" className="link" onClick={props.onRetake}>
              <Icon name="camera" />
              撮り直す
            </button>
          </span>
          <span className="mono">Photo</span>
          <span />
        </div>
        <h1 className="h1">
          <Phrases text="この写真でよろしいですか？" />
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
          <button type="button" className="btn btn--line" onClick={() => void go(close)}>
            やめる
          </button>
          <button type="button" className="btn" disabled={!photo} onClick={() => setStep("place")}>
            <Icon name="arrow" />
            次へ
          </button>
        </div>
      </Screen>
    );
  }

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
        <Phrases text={`${shot.number}枚目の写真を残しました`} />
      </h1>
      {props.reminderOn && props.nextReminderAt !== null && (
        <p className="small clear__sub">
          次のリマインダーは <span className="latin">{clock(props.nextReminderAt)}</span> ごろです。
        </p>
      )}
      {offer && (
        <section className="clear__offer bracket" aria-labelledby={labelId}>
          <div className="kv">
            <p className="h3">
              <span id={labelId}>リマインダー</span>
              <Info info={reminderInfo} label="リマインダーについて" />
            </p>
            <Seg on={props.reminderOn} labelledBy={labelId} disabled={props.busy} onToggle={reminder.toggle} />
          </div>
          <Pop info={reminderInfo} text={`${props.reminderTerms.intervalMinutes}分ごとに撮影を知らせる通知が届きます。`} />
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
