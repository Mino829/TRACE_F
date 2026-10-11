"use client";

import { useMemo } from "react";

import type { PushSupport } from "@/lib/ping-log/environment";
import type { PushPlan } from "@/lib/ping-log/push";
import { MAX_PHOTOS } from "@/lib/ping-log/record";
import type { LogEntry } from "@/lib/ping-log/store";

import { ArrivalWindow } from "./arrival-window";
import { BlobImage } from "./blob-image";
import { MemoryWindow, type MemoryPhoto } from "./memory-window";
import { ReminderSwitch } from "./reminder-switch";
import { PxButton, Sentences, Window, clock } from "./ui";

/**
 * The participant's home once they have joined: a reminder waiting for an
 * answer, today's photos shown large, the camera button, the reminder's
 * switch, and at the foot the QR button for arriving at ShibaLab. The menu
 * lives behind the header's button; details sit behind "i" marks. Nothing
 * here mentions where photos were taken: that stays a surprise for the
 * exhibition, and only the consent lists it.
 */

type Props = {
  support: PushSupport;
  /** The phone's subscription while it lasts; it may be the developer screen's accuracy ping. */
  plan: PushPlan | null;
  /** Null past the day's last ping. */
  nextPingAt: number | null;
  /** A reminder waiting for an answer: its banner holds the yellow button, so the camera button steps back. */
  pendingAt: string | null;
  /** Today's photos, oldest first. */
  photos: LogEntry[];
  busy: boolean;
  onTakePhoto: () => void;
  onSkipReminder: () => void;
  /** Resolves to an error message, or null once the reminder is switched. */
  onReminder: (on: boolean) => Promise<string | null>;
  onResend: () => void;
  /** The QR button for arriving at ShibaLab. */
  onArrive: () => void;
};

/** The phone's photos for the memory window, newest first, each at its own shape. */
function memoryPhotos(entries: LogEntry[]): MemoryPhoto[] {
  return [...entries].reverse().map((entry) => {
    const meta = entry.record.photo;
    const time = clock(entry.record.takenAt);
    return {
      id: entry.id,
      time,
      ratio: meta && meta.width > 0 && meta.height > 0 ? meta.width / meta.height : 3 / 4,
      image: entry.photo ? <BlobImage blob={entry.photo} alt={`${time} の写真`} className="px-polaroid__photo" /> : <span className="px-polaroid__photo block" />,
      unsent: !entry.sentAt,
    };
  });
}

export function HomeView(props: Props) {
  const full = props.photos.length >= MAX_PHOTOS;
  const photos = useMemo(() => memoryPhotos(props.photos), [props.photos]);

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

      <MemoryWindow photos={photos} max={MAX_PHOTOS} busy={props.busy} onResend={props.onResend} />

      <div className="px-on-scene flex flex-col gap-2">
        <PxButton block size="lg" icon="camera" variant={props.pendingAt ? "secondary" : "primary"} onClick={props.onTakePhoto} disabled={full}>
          写真を撮る
        </PxButton>
        {full && (
          <p className="px-note px-note--float">
            <Sentences text={`${MAX_PHOTOS}枚撮り終えました。撮影は${MAX_PHOTOS}枚までです。`} />
          </p>
        )}
      </div>

      <ReminderSwitch
        on={props.plan?.purpose === "photo"}
        support={props.support}
        busy={props.busy}
        nextAt={props.plan?.purpose === "photo" ? props.nextPingAt : null}
        onChange={props.onReminder}
      />

      <ArrivalWindow onScan={props.onArrive} />
    </>
  );
}
