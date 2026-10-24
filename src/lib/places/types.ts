/**
 * Where a photo was taken, as the participant says it: one checkpoint of the
 * campus, chosen on a small map (building -> floor -> checkpoint). The graph's
 * waypoints are never shown; only the checkpoints below are. A checkpoint is a
 * claim, not a measurement: nothing about the phone's position is read.
 *
 * `places.json` is generated from models/trace/campus_graph.json by
 * models/trace/export_places.py and kept small on purpose (the phone loads it
 * with the page). Coordinates are metres in the Blender campus frame minus
 * `origin`: x east, y north, z up from the ground.
 */

export type BuildingId = "kyoshitsu" | "koryu" | "honbu" | "kenkyu" | "outdoor";

export type PlacePoint = [x: number, y: number];

export type Floor = {
  /** "1F" ... "14F", or "屋外" / "屋外2F" for the open ground. */
  label: string;
  /** Height of the floor above the ground, in metres. */
  z: number;
  /** Closed outlines of the floor plate, each a loop of points (the outline of the building at this floor). */
  outlines: PlacePoint[][];
};

export type Building = {
  id: BuildingId;
  name: string;
  /** Where the building's label sits (x, y, z). */
  labelAt: [number, number, number];
  /** Top of the roof, in metres. */
  roofZ: number;
  /** The building seen from above: loops of the outline at ground level (the footprint). */
  footprint: PlacePoint[][];
  /** Floors from the lowest to the highest, only those with a checkpoint. */
  floors: Floor[];
};

export type Checkpoint = {
  /** The graph node's id; what is stored with a photo. */
  id: string;
  name: string;
  building: BuildingId;
  floor: string;
  x: number;
  y: number;
  z: number;
  /** A bridge between two buildings: shown in both. `joins` is the other building. */
  joins?: BuildingId;
};

export type PlacesData = {
  /** campus_graph.json's campusGraphVersion; stored with every photo's place. */
  graphVersion: string;
  /** Subtracted from every x, y so the numbers stay small. */
  origin: [number, number];
  buildings: Building[];
  checkpoints: Checkpoint[];
};

/** What is stored with a photo: enough to put it back on the graph, and to notice a graph that has since changed. */
export type PhotoPlace = {
  checkpointId: string;
  /** The name shown when it was chosen. */
  name: string;
  building: BuildingId;
  floor: string;
  graphVersion: string;
  /** ISO time the participant chose it. */
  selectedAt: string;
};
