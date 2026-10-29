/**
 * Schema 3 photos contain participant-selected checkpoints, never a phone
 * position. Older accuracy and photo records remain typed for local viewing
 * and deletion; they are not eligible for upload.
 */
import { COORDINATE_VERSION, type CampusPx, type LocalEnu, type Wgs84 } from "@/lib/geo/campus-georeference";

import type { DeviceContext, NetworkInfo, OrientationSample } from "./context";
import type { PhotoPlace } from "@/lib/places/types";

import type { ExifSummary } from "./exif";

/**
 * 2 added `purpose`. Schema 1 records come from before the photo memory and were all accuracy runs.
 * 3 added `place`: where the participant says a photo was taken. A photo's record no longer carries a position fix.
 */
export const RECORD_SCHEMA = 3;

export type RecordPurpose = "photo-memory" | "accuracy";

export const PURPOSE_LABEL: Record<RecordPurpose, string> = {
  "photo-memory": "写真メモリー",
  accuracy: "精度テスト",
};

/** Offline fallback limit; with the backend the public config sets the session limit. */
export const MAX_PHOTOS = 12;

export type Fix = {
  /** Date.now() when the browser delivered it. */
  receivedAt: number;
  /** position.timestamp: when the fix was taken, which can be older than receivedAt. */
  timestamp: number;
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
};

export type GeoError = { at: number; code: number; message: string };

export type Capture = {
  startedAt: number;
  endedAt: number | null;
  /** Legacy watch options; new photo records use an empty object. */
  options: PositionOptions;
  fixes: Fix[];
  /** Legacy low-accuracy reading, never requested for new photos. */
  coarse: Fix | null;
  coarseError: string | null;
  errors: GeoError[];
};

/** A legacy accuracy run's participant-marked location. */
type TruthBase = {
  wgs84: Wgs84;
  level: number;
  levelLabel: string;
  markedAt: number;
};

/** Historical map/plan truth, read for existing records only. */
export type Truth =
  | (TruthBase & {
      method: "campus-plan";
      coordinateVersion: string;
      /**
       * Which planPlacement the drawings were laid out with when the mark was
       * placed. Absent before toyosu-plan-2026-10-22.1, when the buildings sat
       * where the drawing put them; scripts/reproject-campus-truth.ts moves those.
       */
      planPlacementVersion?: string;
      campusPx: CampusPx;
      /** The classroom building's 912x1552 plan frame, the frame the georeference is fitted in. */
      planPx: { x: number; y: number };
      local: LocalEnu;
      /** Floor level above the ground floor, from the drawings' 4.2 m storey. */
      floorHeightMetres: number;
      /** Structures whose drawn floor at this level contains the point; empty outdoors. */
      buildingIds: string[];
      /** Screen pixels per sheet pixel when the mark was placed (one sheet pixel is about 6 cm). */
      viewScale: number;
    })
  | (TruthBase & {
      method: "map";
      /** Map zoom when the pin was placed (at 18 one screen pixel is about 0.5 m in Tokyo). */
      zoom: number;
      layer: MapLayer;
    });

export type MapLayer = "gsi-std" | "gsi-photo";

export type PhotoMeta = {
  type: string;
  bytes: number;
  width: number;
  height: number;
  lastModified: number;
  /** Read from the original before it is shrunk, since re-encoding drops it. */
  exif: ExifSummary | null;
};

export type SourceGuess = "gnss" | "wifi" | "cell";

export type LogRecord = {
  schema: 1 | 2 | typeof RECORD_SCHEMA;
  /** Absent on schema 1; read it through purposeOf(). */
  purpose?: RecordPurpose;
  id: string;
  /** ping: answering a notification (a reminder, for a photo). manual: started by hand. */
  kind: "ping" | "manual";
  /** The practice run of the setup screens that schema 1 had. Always false now. */
  tutorial: boolean;
  deviceId: string;
  consentVersion: string;
  consentedAt: string;
  promptedAt: string | null;
  takenAt: string;
  capture: Capture;
  sourceGuess: SourceGuess | null;
  coordinateVersion: string;
  /** Near the Toyosu campus, where the drawings were offered for marking. */
  insideCampus: boolean;
  /** The floor the person picked, kept even when they could not point at the spot. */
  reportedLevel: number | null;
  truth: Truth | null;
  /** The person was asked for the truth and said they did not know. */
  truthSkipped: boolean;
  selfReport: { wifi: "on" | "off" | null };
  device: DeviceContext;
  network: NetworkInfo | null;
  networkAtSend: NetworkInfo | null;
  orientation: OrientationSample | null;
  photo: PhotoMeta | null;
  /** The checkpoint the participant chose for this photo (schema 3, photos). Never read from the phone. */
  place?: PhotoPlace | null;
};

export function purposeOf(record: LogRecord): RecordPurpose {
  return record.purpose ?? "accuracy";
}

export const SOURCE_LABEL: Record<SourceGuess, string> = {
  gnss: "GPS など衛星",
  wifi: "Wi-Fi など",
  cell: "基地局など",
};

/** Great-circle distance in metres, for errors anywhere rather than only near the campus origin. */
export function haversineMetres(a: Wgs84, b: Wgs84): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

export { COORDINATE_VERSION };
