"use client";

/* eslint-disable @next/next/no-img-element -- the photo is a local blob: URL */

import { useEffect, useMemo, useRef, useState } from "react";

import type { Consent } from "@/lib/ping-log/consent";
import { deviceContext, networkInfo, type NetworkInfo } from "@/lib/ping-log/context";
import type { PushSupport } from "@/lib/ping-log/environment";
import { preparePhoto } from "@/lib/ping-log/photo";
import { deviceId } from "@/lib/ping-log/push";
import { COORDINATE_VERSION, RECORD_SCHEMA, guessSource, nearCampus, type Capture, type PhotoMeta } from "@/lib/ping-log/record";
import type { LogEntry, SaveOutcome } from "@/lib/ping-log/store";

import { ClearTitle } from "./clear-screen";
import { useLayer } from "./layer";
import { PixelIcon } from "./pixel-icon";
import { ReminderSwitch } from "./reminder-switch";
import { Phrases, PxButton, Sentences, Window, clock } from "./ui";

/**
 * A photo from the camera to the day's memory: a look at it, then
 * "メモリーに追加", then the clear screen. The photo's one fix was asked for
 * the moment the camera handed the photo over; adding waits for it (ten
 * seconds at most) and keeps the photo without a place if none came. The
 * screen never shows the place: that waits for the exhibition.
 */

/** A photo the camera just handed over. */
export type Shot = {
  id: string;
  file: File;
  /** When the camera handed it over: the photo's time. */
  receivedAt: number;
  /** The reminder it answers, if it was taken from one. */
  promptedAt: string | null;
  location: Promise<Capture>;
  network: NetworkInfo | null;
  /** Which of the day's photos it would be, counted when it was taken. */
  number: number;
};

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
  onRetake: () => void;
  onSave: (entry: LogEntry) => Promise<SaveOutcome>;
  /** Resolves to an error message, or null once the reminder is switched. */
  onReminder: (on: boolean) => Promise<string | null>;
  onClose: () => void;
};

type Step = "preview" | "saving" | "done";

/** Only a photo still waiting is worth a word; a sent one needs none. */
const OUTCOME: Record<SaveOutcome, string> = {
  sent: "",
  queued: "まだ送信できていません。電波の良い場所で送信してください。",
  local: "",
};

export function PhotoFlow({ shot, consent, offerReminder, support, reminderOn, busy, nextReminderAt, onRetake, onSave, onReminder, onClose }: Props) {
  const [photo, setPhoto] = useState<{ blob: Blob; meta: PhotoMeta } | null>(null);
  const [step, setStep] = useState<Step>("preview");
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [error, setError] = useState("");
  // Decided when the photo arrives, so switching it on here keeps the switch in view.
  const [offer] = useState(offerReminder);
  const close = useLayer("#photo", onClose);
  const titleRef = useRef<HTMLHeadingElement>(null);

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

  // The heading moves from the question to the result; a screen reader follows it.
  const finished = step === "done";
  useEffect(() => {
    titleRef.current?.focus();
  }, [finished]);

  const url = useMemo(() => (photo ? URL.createObjectURL(photo.blob) : null), [photo]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  const add = async () => {
    if (!photo) return;
    setStep("saving");
    setError("");
    try {
      const final = await shot.location;
      const first = final.fixes[0] ?? null;
      const id = crypto.randomUUID();
      const entry: LogEntry = {
        id,
        photo: photo.blob,
        sentAt: null,
        record: {
          schema: RECORD_SCHEMA,
          purpose: "photo-memory",
          id,
          kind: shot.promptedAt ? "ping" : "manual",
          tutorial: false,
          deviceId: deviceId(),
          consentVersion: consent.version,
          consentedAt: consent.at,
          promptedAt: shot.promptedAt,
          takenAt: new Date(shot.receivedAt).toISOString(),
          capture: final,
          sourceGuess: first ? guessSource(first) : null,
          coordinateVersion: COORDINATE_VERSION,
          insideCampus: first ? nearCampus(first) : false,
          reportedLevel: null,
          truth: null,
          truthSkipped: false,
          selfReport: { wifi: null },
          // The consent names the phone and the network, not the battery.
          device: { ...(await deviceContext()), battery: null },
          network: shot.network,
          networkAtSend: networkInfo(),
          orientation: null,
          photo: photo.meta,
        },
      };
      setOutcome(await onSave(entry));
      setStep("done");
      navigator.vibrate?.(40);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "保存できませんでした。");
      setStep("preview");
    }
  };

  return (
    <div className="px-stage fixed inset-0 z-40 flex flex-col" role="dialog" aria-modal="true" aria-labelledby="photo-title">
      <header className="flex items-center gap-2 px-2 pt-[max(6px,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={close}
          className="flex min-h-11 min-w-11 items-center gap-2 px-2 text-[15px] text-(--px-ink-2) focus-visible:outline-3 focus-visible:outline-(--px-focus)"
        >
          <PixelIcon name="cross" size={14} />
          {step === "done" ? "閉じる" : "やめる"}
        </button>
        <p className="px-label mx-auto">{step === "done" ? "Clear" : "Photo"}</p>
        <span className="min-w-11 px-2" aria-hidden="true" />
      </header>

      {step !== "done" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-4">
          <h2 id="photo-title" ref={titleRef} tabIndex={-1} className="text-[26px] leading-tight outline-none">
            この写真を残しますか？
          </h2>
          {/* The photo fills the room left between the question and the buttons. */}
          <div className="flex flex-1 flex-col justify-center gap-5 py-5">
            <figure className="px-polaroid px-polaroid--large mx-auto">
              {url ? (
                <img src={url} alt="撮った写真" className="px-polaroid__photo" />
              ) : (
                <div className="px-polaroid__photo grid aspect-[4/3] place-items-center">
                  {error ? null : <div className="px-loader" aria-label="写真を読み込んでいます"><i /><i /><i /></div>}
                </div>
              )}
              <figcaption className="px-polaroid__caption">{clock(shot.receivedAt)}</figcaption>
            </figure>
            {error && (
              <p className="px-note" data-tone="warn" role="alert">
                <Sentences text={error} />
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4">
          <div className="space-y-6 pt-1 text-center">
            <ClearTitle />
            {/* The rings spread behind the photo. */}
            <div className="relative isolate mx-auto mt-8 w-fit">
              <div className="px-ripple" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <figure className="px-polaroid px-polaroid--small">
                {url && <img src={url} alt="残した写真" className="px-polaroid__photo" />}
                <figcaption className="px-polaroid__caption">{clock(shot.receivedAt)}</figcaption>
              </figure>
            </div>
            <Window className="text-left">
              <div role="status" className="space-y-2">
                <h2 id="photo-title" ref={titleRef} tabIndex={-1} className="text-[19px] outline-none">
                  <Phrases text={`${shot.number}枚目のメモリーを残しました`} />
                </h2>
                <p className="text-[15px] text-(--px-ink-2)">
                  <Sentences text={`${outcome ? OUTCOME[outcome] : ""}${nextReminderAt !== null ? `次のリマインダーは ${clock(nextReminderAt)} ごろです。` : ""}`} />
                </p>
              </div>
            </Window>
            {offer && (
              <div className="text-left">
                <ReminderSwitch on={reminderOn} support={support} busy={busy} nextAt={nextReminderAt} onChange={onReminder} />
              </div>
            )}
          </div>
        </div>
      )}

      <div className="px-actionbar">
        {step === "done" ? (
          <PxButton block onClick={close}>
            ホームへもどる
          </PxButton>
        ) : (
          <>
            <PxButton variant="secondary" onClick={onRetake} disabled={step === "saving"}>
              撮り直す
            </PxButton>
            <PxButton block icon="check" onClick={() => void add()} disabled={!photo || step === "saving"}>
              {step === "saving" ? "保存しています…" : "メモリーに追加"}
            </PxButton>
          </>
        )}
      </div>
    </div>
  );
}
