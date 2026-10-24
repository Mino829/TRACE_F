import type { Consent } from "./consent";
import { deviceContext, networkInfo, type NetworkInfo } from "./context";
import { emptyCapture } from "./capture";
import { deviceId } from "./push";
import { COORDINATE_VERSION, RECORD_SCHEMA, type PhotoMeta } from "./record";
import type { PhotoPlace } from "@/lib/places/types";
import type { LogEntry } from "./store";

/** A photo the camera just handed over. */
export type Shot = {
  id: string;
  file: File;
  /** When the camera handed it over: the photo's time. */
  receivedAt: number;
  /** The reminder it answers, if it was taken from one. */
  promptedAt: string | null;
  network: NetworkInfo | null;
  /** Which of the day's photos it would be, counted when it was taken. */
  number: number;
};

/**
 * The record of a photo added to the day's memory. Where it was taken is the
 * checkpoint the participant chose for it: the phone's position is never asked
 * for, and the photo's own EXIF is dropped when it is shrunk.
 */
export async function photoEntry(shot: Shot, photo: { blob: Blob; meta: PhotoMeta }, consent: Consent, place: PhotoPlace): Promise<LogEntry> {
  const id = crypto.randomUUID();
  return {
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
      capture: emptyCapture(),
      sourceGuess: null,
      coordinateVersion: COORDINATE_VERSION,
      insideCampus: false,
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
      place,
    },
  };
}
