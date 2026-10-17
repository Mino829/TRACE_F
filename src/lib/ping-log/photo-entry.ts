import type { Consent } from "./consent";
import { deviceContext, networkInfo, type NetworkInfo } from "./context";
import { deviceId } from "./push";
import { COORDINATE_VERSION, RECORD_SCHEMA, guessSource, nearCampus, type Capture, type PhotoMeta } from "./record";
import type { LogEntry } from "./store";

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

/**
 * The record of a photo added to the day's memory. It waits for the photo's
 * one fix, asked for the moment the camera handed the photo over (ten
 * seconds at most), and keeps the photo without a place if none came.
 */
export async function photoEntry(shot: Shot, photo: { blob: Blob; meta: PhotoMeta }, consent: Consent): Promise<LogEntry> {
  const final = await shot.location;
  const first = final.fixes[0] ?? null;
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
}
