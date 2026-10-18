import { NODES, toScene, type Vec3 } from "./campus-graph";

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
  /** Named stops along the way, for the caption. */
  stops: { s: number; name: string }[];
}

export function buildRoutePath(nodeIds: readonly string[]): RoutePath {
  const points: Vec3[] = [];
  const at: number[] = [];
  const stops: { s: number; name: string }[] = [];
  let s = 0;
  for (const id of nodeIds) {
    const node = NODES.get(id);
    if (!node) throw new Error(`Unknown node: ${id}`);
    const p = toScene(node.threeD);
    if (points.length) s += dist(points[points.length - 1], p);
    points.push(p);
    at.push(s);
    if (node.role === "checkpoint") stops.push({ s, name: node.name });
  }
  return { points, at, length: s, stops };
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

/** The last named stop passed by s. */
export function stopAt(path: RoutePath, s: number): string {
  let name = path.stops[0]?.name ?? "";
  for (const stop of path.stops) if (stop.s <= s) name = stop.name;
  return name;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
