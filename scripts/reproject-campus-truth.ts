/**
 * Moves accuracy-run truths marked on the campus drawings before planPlacement
 * (Mino829/TRACE_F#32) to where the corrected placement puts them.
 *
 * A mark was a tap on the sheet, next to buildings drawn where the campus diary
 * put them. Taps on a building that planPlacement now moves are moved with it,
 * keeping their place inside the building; taps elsewhere keep their position.
 * Nothing is written to the database: the script reads an export and writes a
 * summary and the UPDATE statements for a person to check and run.
 *
 *   npx wrangler d1 execute <db> --remote --json \
 *     --command "SELECT id, payload FROM records WHERE truth_method = 'campus-plan' OR truth_method IS NULL" > records.json
 *   npm run reproject:truth -- records.json out/reprojected
 *
 * writes out/reprojected.json and out/reprojected.sql.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  PLAN_PLACEMENT_VERSION,
  campusPxToMetres,
  campusPxToPlanPx,
  correctDrawnPlacement,
  localToWgs84,
  metresToCampusPx,
  planMetresToLocal,
  structuresAt,
  type CampusPx,
} from "@/lib/geo/campus-georeference";
import { buildings, toyosuClassroom } from "@/lib/map/buildings";
import coordinates from "@/lib/map/toyosu-campus.coordinates.json";
import { haversineMetres } from "@/lib/ping-log/record";

type Row = { id: string; payload: string };
type Fix = { latitude: number; longitude: number };

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("usage: npm run reproject:truth -- <records.json> <output path without extension>");
  process.exit(1);
}

/** Accepts `wrangler d1 execute --json` output or a plain array of rows. */
function readRows(file: string): Row[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const rows = Array.isArray(parsed) && parsed.length > 0 && Array.isArray(parsed[0]?.results)
    ? parsed.flatMap((statement: { results: Row[] }) => statement.results)
    : parsed;
  if (!Array.isArray(rows)) throw new Error(`${file}: expected an array of rows`);
  return rows as Row[];
}

const corrected = new Set(Object.keys(coordinates.planPlacement.buildings));
/** The campus plan drew smaller plates over larger ones, so the smallest is the one that was tapped. */
const drawnArea = new Map(buildings.map((building) => [building.id, building.masterRect.w * building.masterRect.h]));

function sql(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

const summary = [];
const statements = [];
for (const row of readRows(input)) {
  const record = JSON.parse(row.payload);
  const truth = record.truth;
  if (!truth?.campusPx || truth.planPlacementVersion || (truth.method && truth.method !== "campus-plan")) continue;

  const tapped = (truth.buildingIds ?? [])
    .filter((id: string) => corrected.has(id))
    .sort((a: string, b: string) => (drawnArea.get(a) ?? 0) - (drawnArea.get(b) ?? 0))[0] as string | undefined;
  const drawnMetres = campusPxToMetres(truth.campusPx as CampusPx);
  const metres = tapped ? correctDrawnPlacement(tapped, drawnMetres) : drawnMetres;
  const campusPx = metresToCampusPx(metres);
  const local = planMetresToLocal(metres);
  const wgs84 = localToWgs84(local);
  const buildingIds = structuresAt(local, truth.level);

  record.truth = {
    ...truth,
    planPlacementVersion: PLAN_PLACEMENT_VERSION,
    campusPx,
    planPx: campusPxToPlanPx(toyosuClassroom.id, campusPx),
    local,
    wgs84,
    buildingIds,
    markedOnDrawnPlacement: {
      campusPx: truth.campusPx,
      local: truth.local,
      wgs84: truth.wgs84,
      buildingIds: truth.buildingIds,
      movedWith: tapped ?? null,
    },
  };

  const fixes: Fix[] = Array.isArray(record.capture?.fixes) ? record.capture.fixes : [];
  const last: Fix | undefined = fixes.at(-1) ?? record.capture?.coarse ?? undefined;
  const errorM = last ? haversineMetres({ lat: last.latitude, lon: last.longitude }, wgs84) : null;
  const movedMetres = haversineMetres(truth.wgs84, wgs84);

  summary.push({
    id: row.id,
    level: truth.level,
    movedWith: tapped ?? null,
    movedMetres: Number(movedMetres.toFixed(2)),
    buildingsBefore: truth.buildingIds,
    buildingsAfter: buildingIds,
    errorMetres: errorM === null ? null : Number(errorM.toFixed(2)),
  });
  statements.push(
    `UPDATE records SET truth_latitude = ${sql(wgs84.lat)}, truth_longitude = ${sql(wgs84.lon)}, ` +
      `truth_buildings = ${sql(buildingIds.join(","))}, error_m = ${sql(errorM)}, payload = ${sql(JSON.stringify(record))} ` +
      `WHERE id = ${sql(row.id)};`,
  );
}

mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
writeFileSync(`${output}.json`, `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(`${output}.sql`, `${statements.join("\n")}\n`);
const moved = summary.filter((entry) => entry.movedWith);
console.log(
  `${summary.length} campus-plan truths read, ${moved.length} moved with a building (largest ${Math.max(0, ...moved.map((entry) => entry.movedMetres)).toFixed(1)} m), ${summary.length - moved.length} kept in place.`,
);
console.log(`wrote ${output}.json and ${output}.sql`);
