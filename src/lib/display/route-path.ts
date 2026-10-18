import { EDGES, NODES, toScene, type EdgeKind, type Vec3 } from "./campus-graph";

/**
 * A replayed walk as a polyline in scene metres, measured by distance along
 * it. Corners stay sharp (the network is a grid on purpose); anything that
 * needs to look smooth, like the first-person camera, smooths on top of this.
 */
export interface RoutePath {
  points: Vec3[];
  /** Distance from the start to each point. */
  at: number[];
  length: number;
  /** Named stops along the way, for the caption and the map markers. */
  stops: { s: number; name: string; at: Vec3 }[];
  /** Where each point is: "教室棟 3F", or "屋外". */
  places: string[];
  /** The kind of edge from each point to the next (one fewer than points). */
  kinds: EdgeKind[];
}

const EDGE_KIND = new Map<string, EdgeKind>();
for (const e of EDGES) {
  EDGE_KIND.set(`${e.from}|${e.to}`, e.kind);
  EDGE_KIND.set(`${e.to}|${e.from}`, e.kind);
}

export function buildRoutePath(nodeIds: readonly string[]): RoutePath {
  const points: Vec3[] = [];
  const at: number[] = [];
  const stops: RoutePath["stops"] = [];
  const places: string[] = [];
  const kinds: EdgeKind[] = [];
  let s = 0;
  nodeIds.forEach((id, i) => {
    if (i > 0) kinds.push(EDGE_KIND.get(`${nodeIds[i - 1]}|${id}`) ?? "ground");
    const node = NODES.get(id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    const p = toScene(node.threeD);
    if (points.length) s += dist(points[points.length - 1], p);
    points.push(p);
    at.push(s);
    // Outdoor checkpoints can still name a building (研究棟ゲート): those read 屋外.
    places.push(node.building && !node.floor.startsWith("屋外") ? `${node.building} ${node.floor}` : "屋外");
    if (node.role === "checkpoint") stops.push({ s, name: node.name, at: p });
  });
  return { points, at, length: s, stops, places, kinds };
}

/**
 * Walking speed on each kind of edge, in metres per second. Slow enough
 * indoors that the first person can tell where it is; the long outdoor runs
 * go quicker; stairs and escalators slowest, so the climb shows.
 */
export const WALK_SPEED: Record<EdgeKind, number> = { ground: 18, indoor: 8, bridge: 8, escalator: 4, stairs: 5 };

/**
 * How much the walk should be looking out of the window at s: 1 while riding
 * an escalator, easing in over `before` metres ahead of it and out over
 * `after` metres past it, 0 elsewhere.
 */
export function escalatorWeight(path: RoutePath, s: number, before = 5, after = 7): number {
  let w = 0;
  path.kinds.forEach((kind, i) => {
    if (kind !== "escalator") return;
    const a = path.at[i];
    const b = path.at[i + 1];
    if (s >= a && s <= b) w = 1;
    else if (s < a && s > a - before) w = Math.max(w, smooth((s - (a - before)) / before));
    else if (s > b && s < b + after) w = Math.max(w, smooth(1 - (s - b) / after));
  });
  return w;
}

function smooth(x: number): number {
  return x * x * (3 - 2 * x);
}

/**
 * When the walk reaches each point, at WALK_SPEED times `speed`. With a
 * `duration`, the same pacing is stretched or squeezed to fit it instead.
 */
export interface Timeline {
  duration: number;
  /** Distance along the route after t seconds. */
  sAt(t: number): number;
}

export function buildTimeline(path: RoutePath, speed = 1, duration?: number): Timeline {
  const times = [0];
  path.kinds.forEach((kind, i) => {
    times.push(times[i] + (path.at[i + 1] - path.at[i]) / (WALK_SPEED[kind] * speed));
  });
  const natural = times[times.length - 1] || 1;
  const scale = duration ? duration / natural : 1;
  return {
    duration: natural * scale,
    sAt(t) {
      const u = Math.min(natural, Math.max(0, t / scale));
      let i = 0;
      while (i + 2 < times.length && times[i + 1] <= u) i++;
      const f = (u - times[i]) / (times[i + 1] - times[i] || 1);
      return path.at[i] + (path.at[i + 1] - path.at[i]) * Math.min(1, f);
    },
  };
}

/** Point at distance s (clamped to the ends). */
export function pointAt(path: RoutePath, s: number): Vec3 {
  const { points, at } = path;
  if (s <= 0) return points[0];
  if (s >= path.length) return points[points.length - 1];
  let lo = 0;
  let hi = at.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= s) lo = mid;
    else hi = mid;
  }
  const t = (s - at[lo]) / (at[hi] - at[lo] || 1);
  const a = points[lo];
  const b = points[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Where to look from s: the first point ahead that has moved sideways by at
 * least `ahead` metres. Searching by horizontal distance keeps a straight
 * stair from tipping the view to the ceiling.
 */
export function lookAheadAt(path: RoutePath, s: number, ahead: number): Vec3 {
  const here = pointAt(path, s);
  for (let d = 1; s + d <= path.length; d += 1) {
    const p = pointAt(path, s + d);
    if (Math.hypot(p[0] - here[0], p[2] - here[2]) >= ahead) return p;
  }
  return pointAt(path, path.length);
}

/** Where the walk is at s (the place of the last point passed). */
export function placeAt(path: RoutePath, s: number): string {
  let i = 0;
  while (i + 1 < path.at.length && path.at[i + 1] <= s) i++;
  return path.places[i];
}

/** The last named stop passed by s. */
export function stopAt(path: RoutePath, s: number): string {
  let name = path.stops[0]?.name ?? "";
  for (const stop of path.stops) if (stop.s <= s) name = stop.name;
  return name;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
