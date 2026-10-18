import graph from "../../../models/trace/campus_graph.json";

/**
 * The walkable network the exhibit replays visitors along (models/trace,
 * issue #8): checkpoints, rooms and waypoints every few metres, joined by
 * straight edges that only ever run along the campus grid or straight up a
 * stair / escalator. Coordinates come from the Blender scene, so the same
 * numbers place a point in campus.glb.
 */
export type NodeRole = "checkpoint" | "room" | "waypoint";
export type EdgeKind = "ground" | "stairs" | "escalator" | "indoor" | "bridge";

export interface GraphNode {
  id: string;
  name: string;
  role: NodeRole;
  building: string | null;
  floor: string;
  threeD: { x: number; y: number; z: number };
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
}

export const CAMPUS_GRAPH_VERSION: string = graph.campusGraphVersion;
export const NODES: ReadonlyMap<string, GraphNode> = new Map(
  (graph.nodes as GraphNode[]).map((n) => [n.id, n]),
);
export const EDGES: readonly GraphEdge[] = graph.edges as GraphEdge[];

/**
 * campus.glb is exported around this point (scripts/export_web.py) with Y up,
 * so a Blender point (x, y, z) sits at (x - ox, z, -(y - oy)) in the scene.
 */
const ORIGIN = { x: -160.48048400878906, y: -14.865501403808594 };

/**
 * The campus grid: the classroom building's long side (buildings/配置.json).
 * Every ground edge of the network runs along it or at right angles to it.
 */
export const GRID_THETA = 0.8168140899333461;

export type Vec3 = [number, number, number];

export function toScene(p: { x: number; y: number; z: number }): Vec3 {
  return [p.x - ORIGIN.x, p.z, -(p.y - ORIGIN.y)];
}

const adjacency = (() => {
  const adj = new Map<string, { to: string; weight: number }[]>();
  for (const id of NODES.keys()) adj.set(id, []);
  for (const e of EDGES) {
    const a = NODES.get(e.from)!.threeD;
    const b = NODES.get(e.to)!.threeD;
    const weight = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    adj.get(e.from)!.push({ to: e.to, weight });
    adj.get(e.to)!.push({ to: e.from, weight });
  }
  return adj;
})();

/** Shortest walk between two nodes (Dijkstra over metres walked). */
export function shortestPath(from: string, to: string): string[] {
  if (!NODES.has(from) || !NODES.has(to)) throw new Error(`Unknown node: ${from} -> ${to}`);
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  while (true) {
    let u: string | undefined;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        u = id;
      }
    }
    if (u === undefined) throw new Error(`No path: ${from} -> ${to}`);
    if (u === to) break;
    done.add(u);
    for (const { to: v, weight } of adjacency.get(u)!) {
      if (best + weight < (dist.get(v) ?? Infinity)) {
        dist.set(v, best + weight);
        prev.set(v, u);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

/**
 * Expands the checkpoints a visitor passed into the full walk. The backend
 * will eventually hand over this node list itself (FR-024); until then the
 * prototype stitches shortest paths between checkpoints.
 */
export function routeThrough(stops: readonly string[]): string[] {
  const route = [stops[0]];
  for (let i = 1; i < stops.length; i++) route.push(...shortestPath(stops[i - 1], stops[i]).slice(1));
  return route;
}

/** Big tree (Toyosu station side) up through the buildings to ShibaLab, 3F room 301. */
export const SAMPLE_STOPS = [
  "big-tree", "hq-piloti", "koryu-plaza", "grand-stairs-bottom", "hq-exchange-bridge", "hq-entrance",
  "hq-4f-bridge", "exchange-4f", "exchange-6f-hall", "classroom-6f-bridge", "classroom-5f-lobby",
  "classroom-4f-lobby", "classroom-3f-lobby", "shibalab",
] as const;
