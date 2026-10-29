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
export const WALK_SPEED: Record<EdgeKind, number> = { ground: 18, indoor: 8, bridge: 8, escalator: 4, elevator: 3, stairs: 5 };

/**
 * How much the walk should be looking out of the window at s, riding an
 * escalator: facing ahead as it steps on, turning toward the window over the
 * middle of the ride (never more than `peak`, so the way ahead stays in the
 * corner of the view), and facing ahead again before it steps off. 0 elsewhere.
 */
export function escalatorWeight(path: RoutePath, s: number, peak = 0.6): number {
  let w = 0;
  path.kinds.forEach((kind, i) => {
    if (kind !== "escalator") return;
    const a = path.at[i];
    const b = path.at[i + 1];
    if (s <= a || s >= b) return;
    const f = (s - a) / (b - a);
    // Ahead for the first and last fifth, a smooth bump in between.
    const bump = f < 0.2 || f > 0.8 ? 0 : Math.sin(((f - 0.2) / 0.6) * Math.PI);
    w = Math.max(w, peak * smooth(bump));
  });
  return w;
}

/**
 * True while s is on an elevator edge. The car only moves straight up or down,
 * so the drone holds its heading and the walk keeps level until the doors open.
 */
export function elevatorRiding(path: RoutePath, s: number): boolean {
  return path.kinds.some((kind, i) => kind === "elevator" && s > path.at[i] && s < path.at[i + 1]);
}

/**
 * Riding an elevator at s, the level way out of the car at the floor where the
 * ride ends: from the car to the first point at least 0.5m away on the level.
 * People turn round to face the doors while the car moves, so the walk does too
 * instead of staring at the back wall. null when not riding or the walk ends in the car.
 */
export function elevatorExit(path: RoutePath, s: number): Vec3 | null {
  let i = path.kinds.findIndex((kind, k) => kind === "elevator" && s > path.at[k] && s < path.at[k + 1]);
  if (i < 0) return null;
  while (i + 1 < path.kinds.length && path.kinds[i + 1] === "elevator") i++;
  const car = path.points[i + 1];
  for (let k = i + 2; k < path.points.length; k++) {
    const dx = path.points[k][0] - car[0];
    const dz = path.points[k][2] - car[2];
    const len = Math.hypot(dx, dz);
    if (len >= 0.5) return [dx / len, 0, dz / len];
  }
  return null;
}

/**
 * How far along the walk s is from the nearest elevator ride (0 while riding,
 * Infinity on a walk without one). Near a car the walk stops rounding corners
 * off, so it steps straight through the doors instead of brushing the door edge.
 */
export function elevatorDistance(path: RoutePath, s: number): number {
  let best = Infinity;
  path.kinds.forEach((kind, i) => {
    if (kind !== "elevator") return;
    const a = path.at[i];
    const b = path.at[i + 1];
    best = Math.min(best, s < a ? a - s : s > b ? s - b : 0);
  });
  return best;
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
 * stair from tipping the view to the ceiling. The search stops where an
 * elevator ride starts (its car on this floor): an elevator moves straight up
 * or down, so looking past it pointed the view at a floor several storeys
 * away and the walk dipped to the white floor just before stepping in.
 */
export function lookAheadAt(path: RoutePath, s: number, ahead: number): Vec3 {
  const here = pointAt(path, s);
  for (let d = 1; s + d <= path.length; d += 1) {
    if (!elevatorRiding(path, s) && elevatorRiding(path, s + d)) {
      const i = path.kinds.findIndex((kind, k) => kind === "elevator" && s + d > path.at[k] && s + d < path.at[k + 1]);
      return pointAt(path, path.at[i]);
    }
    const p = pointAt(path, s + d);
    if (Math.hypot(p[0] - here[0], p[2] - here[2]) >= ahead) return p;
  }
  return pointAt(path, path.length);
}

/**
 * The general way the walk is heading around s: the level line from `back`
 * metres behind to `ahead` metres in front. Over a long enough window the
 * grid's corners and the step into a room and back out cancel out, so a camera
 * that follows this turns only where the walk really changes direction.
 * null where the window covers less than 2m of level ground (e.g. a stair).
 */
export function travelDirection(path: RoutePath, s: number, back: number, ahead: number): Vec3 | null {
  const a = pointAt(path, s - back);
  const b = pointAt(path, s + ahead);
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  return len < 2 ? null : [dx / len, 0, dz / len];
}

/**
 * Where someone walking the route would actually be at s: the line averaged
 * over `radius` metres either way, so grid corners become short curves (people
 * cut corners) while the straight runs stay on the line.
 */
export function roundedPointAt(path: RoutePath, s: number, radius = 1.5): Vec3 {
  const n = 6;
  const sum: Vec3 = [0, 0, 0];
  for (let i = 0; i <= n; i++) {
    const p = pointAt(path, s - radius + (2 * radius * i) / n);
    sum[0] += p[0];
    sum[1] += p[1];
    sum[2] += p[2];
  }
  return [sum[0] / (n + 1), sum[1] / (n + 1), sum[2] / (n + 1)];
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
