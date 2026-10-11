/**
 * What one record sends to the push worker. A record is one of two things:
 *
 * - photo-memory: a participant's photo, with the one fix taken when the
 *   camera handed it over. This is what the finished work is built from.
 * - accuracy: the team's accuracy run from the developer screen, answered by
 *   pointing at where one stands. It is deliberately raw. It is collected to
 *   find out how wrong a phone's position is on campus and what could correct
 *   it, and a correction thought of later is only testable against data that
 *   was kept: every fix in the window rather than one, the browser's own
 *   fields rather than a summary, and whatever hints exist about where a fix
 *   came from (the Geolocation API does not say whether GPS or Wi-Fi produced it).
 */

import {
  COORDINATE_VERSION,
  campusPxToLocal,
  campusPxToPlanPx,
  insideGeofence,
  localToWgs84,
  structuresAt,
  wgs84ToLocal,
  type CampusPx,
  type LocalEnu,
  type Wgs84,
} from "@/lib/geo/campus-georeference";
import { levelLabel, toyosuClassroom } from "@/lib/map/buildings";
import coordinates from "@/lib/map/toyosu-campus.coordinates.json";

import type { DeviceContext, NetworkInfo, OrientationSample } from "./context";
import type { ExifSummary } from "./exif";

/** 2 added `purpose`. Schema 1 records come from before the photo memory and were all accuracy runs. */
export const RECORD_SCHEMA = 2;

export type RecordPurpose = "photo-memory" | "accuracy";

export const PURPOSE_LABEL: Record<RecordPurpose, string> = {
  "photo-memory": "写真メモリー",
  accuracy: "精度テスト",
};

/** The work's photo memory takes at most twelve photos a day. */
export const MAX_PHOTOS_PER_DAY = 12;

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
  /** The watch: high accuracy, no cached fixes. */
  options: PositionOptions;
  fixes: Fix[];
  /** One extra low-accuracy fix asked for at the start, the network-only answer to compare against. */
  coarse: Fix | null;
  coarseError: string | null;
  errors: GeoError[];
};

/** What every way of marking the truth records. */
type TruthBase = {
  wgs84: Wgs84;
  level: number;
  levelLabel: string;
  markedAt: number;
};

/**
 * Where the person said they were standing. On the Toyosu campus it is marked
 * on the drawings, which know floors and buildings; anywhere else on a map.
 * Instead of asking how sure they were, the zoom they marked at is kept: a
 * point placed at street-level zoom is a looser claim than one placed on a
 * single room.
 */
export type Truth =
  | (TruthBase & {
      method: "campus-plan";
      coordinateVersion: string;
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
  schema: 1 | typeof RECORD_SCHEMA;
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
};

export function purposeOf(record: LogRecord): RecordPurpose {
  return record.purpose ?? "accuracy";
}

export const SOURCE_LABEL: Record<SourceGuess, string> = {
  gnss: "GPS など衛星",
  wifi: "Wi-Fi など",
  cell: "基地局など",
};

/**
 * A guess, because browsers never say. Satellite fixes come with an altitude
 * whose accuracy is a few metres to about fifteen. An iPhone indoors at Toyosu
 * (2026-09-02) reported altitude on every fix but always with an accuracy of
 * 30 m, and its fixes were 18-36 m off, so a 30 m altitude accuracy is read as
 * "not satellites". Wi-Fi fixes are usually within about a hundred metres;
 * anything coarser is the cell network or the IP address. The raw fields are
 * kept for a better rule later.
 */
export function guessSource(fix: Fix): SourceGuess {
  if (fix.altitudeAccuracy !== null && fix.altitudeAccuracy < 20 && fix.accuracy <= 30) return "gnss";
  if (fix.accuracy <= 100) return "wifi";
  return "cell";
}

/** How far outside the drawn campus a fix may sit and still count as on campus. */
const CAMPUS_MARGIN_METRES = 100;

/**
 * On or near the Toyosu campus, where the drawings are offered for marking. A
 * fix is judged by the best case its accuracy allows, so a poor fix taken on
 * campus still gets the drawings.
 */
export function nearCampus(fix: Pick<Fix, "latitude" | "longitude" | "accuracy">): boolean {
  return insideGeofence(wgs84ToLocal({ lat: fix.latitude, lon: fix.longitude }), CAMPUS_MARGIN_METRES + fix.accuracy);
}

/** Great-circle distance in metres, for errors anywhere rather than only near the campus origin. */
export function haversineMetres(a: Wgs84, b: Wgs84): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

export function campusTruth(mark: CampusPx, level: number, markedAt: number, viewScale: number): Truth {
  const local = campusPxToLocal(mark);
  return {
    method: "campus-plan",
    coordinateVersion: COORDINATE_VERSION,
    campusPx: mark,
    planPx: campusPxToPlanPx(toyosuClassroom.id, mark),
    local,
    wgs84: localToWgs84(local),
    level,
    levelLabel: levelLabel(level),
    floorHeightMetres: (level - 1) * coordinates.scale.storeyMetres,
    buildingIds: structuresAt(local, level),
    viewScale,
    markedAt,
  };
}

export function mapTruth(pin: Wgs84, level: number, markedAt: number, zoom: number, layer: MapLayer): Truth {
  return { method: "map", wgs84: pin, level, levelLabel: levelLabel(level), zoom, layer, markedAt };
}

export { COORDINATE_VERSION };
