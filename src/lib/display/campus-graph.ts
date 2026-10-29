import graph from "../../../models/trace/campus_graph.json";

/**
 * The walkable network the exhibit replays visitors along (models/trace,
 * issue #8): checkpoints, rooms and waypoints every few metres, joined by
 * straight edges that only ever run along the campus grid or straight up a
 * stair / escalator. Coordinates come from the Blender scene, so the same
 * numbers place a point in campus.glb.
 */
export type NodeRole = "checkpoint" | "room" | "waypoint";
export type EdgeKind = "ground" | "stairs" | "escalator" | "elevator" | "indoor" | "bridge";

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
/** The other two versions TRACE_B checks on every display frame (Spatial Contract). */
export const COORDINATE_VERSION: string = graph.coordinateVersion;
export const THREE_D_MAP_VERSION: string = graph.threeDMapVersion;
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
  const adj = new Map<string, { to: string; metres: number; kind: EdgeKind }[]>();
  for (const id of NODES.keys()) adj.set(id, []);
  for (const e of EDGES) {
    const a = NODES.get(e.from)!.threeD;
    const b = NODES.get(e.to)!.threeD;
    const metres = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    adj.get(e.from)!.push({ to: e.to, metres, kind: e.kind });
    adj.get(e.to)!.push({ to: e.from, metres, kind: e.kind });
  }
  return adj;
})();

/** How much one metre of each kind of edge costs when choosing a walk. */
export type EdgeCost = Record<EdgeKind, number>;

/** Plain shortest walk in metres. */
export const METRES: EdgeCost = { ground: 1, stairs: 1, escalator: 1, elevator: 1, indoor: 1, bridge: 1 };

/**
 * For test walks: most visitors ride the escalators and stay indoors, so
 * indoor corridors, bridges and above all escalators are cheap and the open
 * ground is dear. Stairs are dearer still, so in the classroom building the
 * walk goes round to the escalators instead of up the end stair next to the door.
 */
export const INDOOR_FIRST: EdgeCost = { ground: 2.5, stairs: 5, escalator: 0.15, elevator: 0.3, indoor: 0.6, bridge: 0.5 };

/** Cheapest walk between two nodes (Dijkstra; metres times the edge kind's cost). */
export function shortestPath(from: string, to: string, cost: EdgeCost = METRES): string[] {
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
    for (const { to: v, metres, kind } of adjacency.get(u)!) {
      const weight = metres * cost[kind];
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
export function routeThrough(stops: readonly string[], cost: EdgeCost = METRES): string[] {
  const route = [stops[0]];
  for (let i = 1; i < stops.length; i++) route.push(...shortestPath(stops[i - 1], stops[i], cost).slice(1));
  return route;
}

/**
 * A test walk that spends its time indoors: in from one of the ways onto
 * campus, through two or three rooms or halls on the upper floors (so the
 * escalators get ridden), ending at ShibaLab.
 */
export function randomIndoorStops(random: () => number = Math.random): string[] {
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)];
  const entrances = ["big-tree", "exchange-road", "classroom-road", "koryu-plaza", "grand-stairs-bottom"];
  const upstairs = [...NODES.values()]
    .filter((n) => (n.role === "room" || n.role === "checkpoint") && n.building && !["1F", "2F"].includes(n.floor))
    .filter((n) => n.id !== "shibalab")
    .map((n) => n.id);
  const stops = [pick(entrances)];
  const chosen: string[] = [];
  const count = 2 + Math.floor(random() * 2);
  while (chosen.length < count) {
    const id = pick(upstairs);
    if (!chosen.includes(id)) chosen.push(id);
  }
  // Visit them nearest first, so the walk keeps going instead of crossing back and forth.
  while (chosen.length) {
    const here = NODES.get(stops[stops.length - 1])!.threeD;
    const far = (id: string) => {
      const p = NODES.get(id)!.threeD;
      return Math.hypot(p.x - here.x, p.y - here.y, (p.z - here.z) * 3);
    };
    chosen.sort((a, b) => far(a) - far(b));
    stops.push(chosen.shift()!);
  }
  return [...stops, "shibalab"];
}

/**
 * Big tree (Toyosu station side) up through the buildings to ShibaLab, 3F room 301,
 * always moving on: under the head office, up the exchange building, over to the
 * classroom building on 6F and down its escalators. (It used to dart back and
 * forth between the plaza and the head office, which spun the cameras round.)
 */
export const SAMPLE_STOPS = [
  "big-tree", "hq-piloti", "hq-exchange-bridge", "exchange-4f", "exchange-6f-hall",
  "classroom-6f-bridge", "classroom-5f-lobby", "classroom-4f-lobby", "classroom-3f-lobby", "shibalab",
] as const;
