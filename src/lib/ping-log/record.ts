/**
 * What one answer to a ping sends to the push worker.
 *
 * The record is deliberately raw. It is collected to find out how wrong a
 * phone's position is on campus and what could correct it, and a correction
 * thought of later is only testable against data that was kept: every fix in
 * the window rather than one, the browser's own fields rather than a summary,
 * and whatever hints exist about where a fix came from (the Geolocation API
 * does not say whether GPS or Wi-Fi produced it).
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

export const RECORD_SCHEMA = 1;

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

export type TruthConfidence = "wall" | "feature" | "open";

/** How precisely the person could point at where they stood, with the error each grade allows. */
export const TRUTH_CONFIDENCE: Record<TruthConfidence, { label: string; metres: number }> = {
  wall: { label: "壁や柱のすぐそば", metres: 0.3 },
  feature: { label: "ドアや部屋の角など、図面の目印のそば", metres: 0.5 },
  open: { label: "廊下や部屋の中ほど（目印なし）", metres: 2 },
};

/** Where the person said they were standing, in every frame an analysis might want. */
export type Truth = {
  coordinateVersion: string;
  campusPx: CampusPx;
  /** The classroom building's 912x1552 plan frame, the frame the georeference is fitted in. */
  planPx: { x: number; y: number };
  local: LocalEnu;
  wgs84: Wgs84;
  level: number;
  levelLabel: string;
  /** Floor level above the ground floor, from the drawings' 4.2 m storey. */
  floorHeightMetres: number;
  /** Structures whose drawn floor at this level contains the point; empty outdoors. */
  buildingIds: string[];
  confidence: TruthConfidence;
  markedAt: number;
};

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
  schema: typeof RECORD_SCHEMA;
  id: string;
  kind: "ping" | "manual";
  deviceId: string;
  consentVersion: string;
  consentedAt: string;
  promptedAt: string | null;
  takenAt: string;
  capture: Capture;
  sourceGuess: SourceGuess | null;
  coordinateVersion: string;
  insideCampus: boolean;
  /** Recorded off campus because the developer view allowed it. */
  forcedOutside: boolean;
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
 * On or near the Toyosu campus. A fix is judged by the best case its accuracy
 * allows, so a poor fix taken on campus is kept: those are the ones the
 * calibration most needs.
 */
export function nearCampus(fix: Pick<Fix, "latitude" | "longitude" | "accuracy">): boolean {
  return insideGeofence(wgs84ToLocal({ lat: fix.latitude, lon: fix.longitude }), CAMPUS_MARGIN_METRES + fix.accuracy);
}

export function buildTruth(mark: CampusPx, level: number, confidence: TruthConfidence, markedAt: number): Truth {
  const local = campusPxToLocal(mark);
  return {
    coordinateVersion: COORDINATE_VERSION,
    campusPx: mark,
    planPx: campusPxToPlanPx(toyosuClassroom.id, mark),
    local,
    wgs84: localToWgs84(local),
    level,
    levelLabel: levelLabel(level),
    floorHeightMetres: (level - 1) * coordinates.scale.storeyMetres,
    buildingIds: structuresAt(local, level),
    confidence,
    markedAt,
  };
}

export { COORDINATE_VERSION };
