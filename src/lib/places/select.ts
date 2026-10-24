import type { Building, BuildingId, Checkpoint, PhotoPlace, PlacesData } from "./types";

/** The order the buildings are offered in: the open ground first, then the way the visitor walks in. */
export const BUILDING_ORDER: BuildingId[] = ["outdoor", "kyoshitsu", "koryu", "honbu", "kenkyu"];

export function buildingOf(data: PlacesData, id: BuildingId): Building | undefined {
  return data.buildings.find((building) => building.id === id);
}

export function buildingName(data: PlacesData, id: BuildingId): string {
  return buildingOf(data, id)?.name ?? id;
}

/** The buildings with at least one checkpoint, in the offered order. */
export function buildingsWithPlaces(data: PlacesData): Building[] {
  return BUILDING_ORDER.flatMap((id) => {
    const building = buildingOf(data, id);
    return building && checkpointsIn(data, id).length > 0 ? [building] : [];
  });
}

/** A checkpoint belongs to its building, and a bridge also to the building it joins. */
export function checkpointsIn(data: PlacesData, building: BuildingId): Checkpoint[] {
  return data.checkpoints.filter((point) => point.building === building || point.joins === building);
}

/** The floors of a building that have a checkpoint, lowest first. */
export function floorsOf(data: PlacesData, building: BuildingId): { label: string; z: number }[] {
  const floors = new Map<string, number>();
  for (const point of checkpointsIn(data, building)) if (!floors.has(point.floor)) floors.set(point.floor, point.z);
  return [...floors].map(([label, z]) => ({ label, z })).sort((a, b) => a.z - b.z);
}

export function checkpointsOn(data: PlacesData, building: BuildingId, floor: string): Checkpoint[] {
  return checkpointsIn(data, building).filter((point) => point.floor === floor);
}

export function findCheckpoint(data: PlacesData, id: string): Checkpoint | undefined {
  return data.checkpoints.find((point) => point.id === id);
}

/** What is stored with a photo when this checkpoint is chosen. */
export function placeOf(data: PlacesData, point: Checkpoint, at: Date = new Date()): PhotoPlace {
  return {
    checkpointId: point.id,
    name: point.name,
    building: point.building,
    floor: point.floor,
    graphVersion: data.graphVersion,
    selectedAt: at.toISOString(),
  };
}

/**
 * Where the picker opens: on the building and floor of the last photo's place,
 * so a run of photos in one spot takes one or two taps; on the open ground
 * otherwise. A place from another graph version is not trusted to still exist.
 */
export function startAt(data: PlacesData, last: PhotoPlace | null): { building: BuildingId; floor: string } {
  const lastPoint = last && last.graphVersion === data.graphVersion ? findCheckpoint(data, last.checkpointId) : undefined;
  if (lastPoint) return { building: lastPoint.building, floor: lastPoint.floor };
  const first = buildingsWithPlaces(data)[0]?.id ?? "outdoor";
  return { building: first, floor: floorsOf(data, first)[0]?.label ?? "" };
}
