"use client";

import { useEffect, useRef } from "react";

import type { Building, BuildingId, Checkpoint, Landmark, PlacePoint, PlacesData } from "@/lib/places/types";
import { LINE_FRAGMENT, LINE_VERTEX, POINT_FRAGMENT, POINT_VERTEX, compileProgram, getContext } from "@/lib/places/webgl";

import "./campus-map.css";

/**
 * The map a participant picks a photo's place on, in three steps:
 *
 *   1. the whole campus, each building drawn at its real height as a light
 *      wireframe (every floor's outline, the roof's, and an upright at each
 *      corner), so a building is told by its shape, not by its name. The
 *      outdoor checkpoints are dots on the ground;
 *   2. a tap on a building flies to it: the others fade back, and a column of
 *      floor buttons appears at the right, highest at the top, like a lift's;
 *   3. a floor: its plate is shaded, the floors above all but vanish (a cut-away),
 *      and its checkpoints light up with their names. A tap picks one.
 *
 * No 3D library: two tiny shaders (src/lib/places/webgl.ts), flat colour. A
 * frame is drawn only while something moves, or while the chosen
 * checkpoint's ring pulses (twenty frames a second, never with reduced motion
 * or a hidden tab).
 */

export type CampusMapProps = {
  data: PlacesData;
  /** null is the whole campus. "outdoor" is not a building here: its checkpoints sit on the ground of the whole view. */
  building: BuildingId | null;
  floor: string | null;
  selectedId: string | null;
  onBuilding: (id: BuildingId | null) => void;
  onFloor: (label: string) => void;
  onSelect: (id: string) => void;
  /** Called when WebGL cannot run (none, or the context was lost): the caller shows a list instead. */
  onUnavailable: () => void;
  /** Pixels at the bottom covered by something laid over the map; the picture is centred in what is left. */
  insetBottom?: number;
  className?: string;
};

const FOV = 34;
const TAN_HALF = Math.tan((FOV * Math.PI) / 360);
const NEAR = 1;
const FAR = 4000;
/** Moving this far (px) turns a touch into a drag: it is not a tap. */
const TAP_SLOP = 8;
/** A checkpoint takes a tap within this many px of its dot: a 48px target round a dot drawn smaller. */
const PICK_RADIUS = 24;
const TWEEN_MS = 350;
const PULSE_INTERVAL = 50;
/** Room kept round the whole campus, and round a building, as a share of the frame. */
const MARGIN_CAMPUS = 0.06;
const MARGIN_BUILDING = 0.08;
/** The floor buttons' column at the right, and the way back at the top left, take this much room. */
const PANEL_ROOM = 64;
const BACK_ROOM = 52;

const PITCH_CAMPUS = (44 * Math.PI) / 180;
/** The whole campus is seen from about here (south-east), give or take a little to fill the frame. */
const CAMPUS_YAW = 0.42;
const PITCH_BUILDING = (30 * Math.PI) / 180;
const PITCH_FLOOR = (40 * Math.PI) / 180;

type V3 = [number, number, number];
type View = { x: number; y: number; z: number; dist: number; yaw: number; pitch: number };
type Cam = { pos: V3; right: V3; up: V3; fwd: V3 };
type Mesh = { buffer: WebGLBuffer; count: number };
type Box = { x0: number; x1: number; y0: number; y1: number };

/** Something drawn with the line program: a buffer, how, and how strongly. */
type Layer = { mesh: Mesh; mode: number; offset: V3; opacity: number; color: V3 };

type FloorPart = {
  label: string;
  index: number;
  /** The floor's height, and the next floor's (the roof's for the top one). */
  z: number;
  top: number;
  loops: PlacePoint[][];
  /** The floor's outline, its corners' uprights up to the next floor, and its plate. */
  ring: Layer;
  posts: Layer;
  fill: Layer;
  button: HTMLButtonElement;
};

type BuildingPart = {
  data: Building;
  floors: FloorPart[];
  roof: Layer;
  box: Box;
  tag: HTMLButtonElement;
};

/** An escalator drawn inside its building: a slanted band (two handrails, the lanes' divide and a few steps). */
type EscalatorPart = { layer: Layer; building: BuildingId; foot: number; head: number };

type Engine = {
  apply: () => void;
  dispose: () => void;
};

export function CampusMap(props: CampusMapProps) {
  const { building, floor, selectedId, insetBottom = 0, data, className } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const propsRef = useRef(props);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let engine: Engine;
    try {
      engine = createEngine(host, data, () => propsRef.current);
    } catch {
      propsRef.current.onUnavailable();
      return;
    }
    engineRef.current = engine;
    engine.apply();
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    engineRef.current?.apply();
  }, [building, floor, selectedId, insetBottom]);

  return <div ref={hostRef} className={`cm${className ? ` ${className}` : ""}`} role="group" aria-label="キャンパスの地図" />;
}

// ---------------------------------------------------------------------------
// Small maths: vectors, the camera, and the matrix handed to the shaders.

/** Campus metres (x east, y north, z up) to the scene (x, up, -north). */
function at(x: number, y: number, z: number): V3 {
  return [x, z, -y];
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

function camOf(v: View): Cam {
  const pos: V3 = [
    v.x + v.dist * Math.cos(v.pitch) * Math.sin(v.yaw),
    v.y + v.dist * Math.sin(v.pitch),
    v.z + v.dist * Math.cos(v.pitch) * Math.cos(v.yaw),
  ];
  const fwd = unit([v.x - pos[0], v.y - pos[1], v.z - pos[2]]);
  const right = unit(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { pos, right, up, fwd };
}

/** Column-major a * b. */
function multiply(a: number[], b: number[]): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

function loopSegments(loops: PlacePoint[][], z: number, out: number[]) {
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      out.push(a[0], z, -a[1], b[0], z, -b[1]);
    }
  }
}

function insidePolygon(p: PlacePoint, loop: PlacePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Inside an outline made of several loops, counting a loop inside another as a hole (even-odd), like a light well or a gate. */
function insideLoops(p: PlacePoint, loops: PlacePoint[][]): boolean {
  let inside = false;
  for (const loop of loops) if (insidePolygon(p, loop)) inside = !inside;
  return inside;
}

/** A loop lying inside another of the same outline: a hole. */
function hasHoles(loops: PlacePoint[][]): boolean {
  return loops.some((loop, i) => loop.length > 0 && loops.some((other, j) => i !== j && insidePolygon(loop[0], other)));
}

/** A checkpoint's name without its bracketed note, for the small label shown before it is tapped. */
function shortName(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim() || name;
}

/** An escalator as lines: both handrails, the line between its two lanes, and a few steps across. */
function escalatorLines(e: Landmark): number[] {
  const [fx, fy, fz] = e.from;
  const [tx, ty, tz] = e.to;
  const len = Math.hypot(tx - fx, ty - fy) || 1;
  // Across the run, on the ground.
  const ax = (-(ty - fy) / len) * (e.width / 2);
  const ay = ((tx - fx) / len) * (e.width / 2);
  const out: number[] = [];
  const line = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => out.push(x0, z0, -y0, x1, z1, -y1);
  for (const k of [-1, 0, 1]) line(fx + ax * k, fy + ay * k, fz + (k === 0 ? 0 : 0.9), tx + ax * k, ty + ay * k, tz + (k === 0 ? 0 : 0.9));
  const steps = Math.max(4, Math.min(9, Math.round(len / 1.6)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = fx + (tx - fx) * t;
    const y = fy + (ty - fy) * t;
    const z = fz + (tz - fz) * t;
    line(x - ax, y - ay, z, x + ax, y + ay, z);
  }
  return out;
}

function bounds(loops: PlacePoint[][]): Box {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const loop of loops) {
    for (const [x, y] of loop) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, x1, y0, y1 };
}

/** Ear clipping: a flat polygon (one outline loop) as triangles, at height 0. */
function triangulate(loop: PlacePoint[]): number[] {
  let pts = loop.filter((p, i) => {
    const q = loop[(i + 1) % loop.length];
    return p[0] !== q[0] || p[1] !== q[1];
  });
  if (pts.length < 3) return [];
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  if (twice < 0) pts = pts.slice().reverse();
  const turn = (a: PlacePoint, b: PlacePoint, c: PlacePoint) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const idx = pts.map((_, i) => i);
  const out: number[] = [];
  const push = (a: PlacePoint, b: PlacePoint, c: PlacePoint) => out.push(a[0], 0, -a[1], b[0], 0, -b[1], c[0], 0, -c[1]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 20000) {
    let clipped = false;
    for (let i = 0; i < idx.length && !clipped; i++) {
      const n = idx.length;
      const ia = idx[(i + n - 1) % n];
      const ib = idx[i];
      const ic = idx[(i + 1) % n];
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      if (turn(a, b, c) <= 1e-9) continue;
      let empty = true;
      for (const k of idx) {
        if (k === ia || k === ib || k === ic) continue;
        const p = pts[k];
        if ((p[0] === a[0] && p[1] === a[1]) || (p[0] === b[0] && p[1] === b[1]) || (p[0] === c[0] && p[1] === c[1])) continue;
        if (turn(a, b, p) >= -1e-9 && turn(b, c, p) >= -1e-9 && turn(c, a, p) >= -1e-9) {
          empty = false;
          break;
        }
      }
      if (!empty) continue;
      push(a, b, c);
      idx.splice(i, 1);
      clipped = true;
    }
    if (!clipped) {
      // A loop that crosses itself: cut it anyway rather than never finishing.
      push(pts[idx[idx.length - 1]], pts[idx[0]], pts[idx[1]]);
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) push(pts[idx[0]], pts[idx[1]], pts[idx[2]]);
  return out;
}

/** A colour of the screen the map sits in (a CSS variable), as 0..1 RGB. */
function readColor(host: HTMLElement, variable: string, fallback: string, rgb: V3): V3 {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${variable},${fallback})`;
  host.appendChild(probe);
  const numbers = getComputedStyle(probe).color.match(/[\d.]+/g);
  host.removeChild(probe);
  return numbers && numbers.length >= 3 ? [Number(numbers[0]) / 255, Number(numbers[1]) / 255, Number(numbers[2]) / 255] : rgb;
}

function button(parent: HTMLElement, className: string, text: string, onTap: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = text;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onTap();
  });
  // A tap on a button is not the start of a drag on the map.
  el.addEventListener("pointerdown", (event) => event.stopPropagation());
  parent.appendChild(el);
  return el;
}

function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ---------------------------------------------------------------------------

function createEngine(host: HTMLDivElement, data: PlacesData, getProps: () => CampusMapProps): Engine {
  const ink = readColor(host, "--fg", "#0c0c0d", [0.047, 0.047, 0.05]);
  /** The paper the floors are laid with, so the light behind the map does not show through a building. */
  const paper = readColor(host, "--bg", "#d3d5d3", [0.827, 0.835, 0.827]);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  const canvas = document.createElement("canvas");
  canvas.className = "cm__canvas";
  canvas.style.touchAction = "none";
  const gl = getContext(canvas);
  if (!gl) throw new Error("WebGL を使えません。");
  const lineProgram = compileProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
  const pointProgram = compileProgram(gl, POINT_VERTEX, POINT_FRAGMENT);
  const lineUniform = {
    mvp: gl.getUniformLocation(lineProgram, "u_mvp"),
    off: gl.getUniformLocation(lineProgram, "u_off"),
    color: gl.getUniformLocation(lineProgram, "u_color"),
  };
  const pointUniform = {
    mvp: gl.getUniformLocation(pointProgram, "u_mvp"),
    size: gl.getUniformLocation(pointProgram, "u_size"),
    color: gl.getUniformLocation(pointProgram, "u_color"),
    kind: gl.getUniformLocation(pointProgram, "u_kind"),
  };
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.enableVertexAttribArray(0);

  host.appendChild(canvas);
  const overlay = document.createElement("div");
  overlay.className = "cm__labels";
  host.appendChild(overlay);

  // The way back to the whole campus, and the floor buttons: plain HTML over the picture.
  const back = button(host, "cm__back", "← 全体", () => getProps().onBuilding(null));
  back.setAttribute("aria-label", "キャンパス全体にもどる");
  const crumb = document.createElement("span");
  crumb.className = "cm__crumb";
  host.appendChild(crumb);
  const panel = document.createElement("div");
  panel.className = "cm__floors";
  panel.setAttribute("role", "group");
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  host.appendChild(panel);

  const buffers: WebGLBuffer[] = [];
  const makeBuffer = (): WebGLBuffer => {
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("バッファを作れませんでした。");
    buffers.push(buffer);
    return buffer;
  };
  const makeMesh = (vertices: number[]): Mesh => {
    const buffer = makeBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    return { buffer, count: vertices.length / 3 };
  };
  const lineLayers: Layer[] = [];
  const fillLayers: Layer[] = [];
  const layer = (mesh: Mesh, mode: number, opacity = 0): Layer => {
    const l: Layer = { mesh, mode, offset: [0, 0, 0], opacity, color: ink };
    (mode === gl.TRIANGLES ? fillLayers : lineLayers).push(l);
    return l;
  };

  const built = data.buildings.filter((b) => b.id !== "outdoor" && (b.footprint.length > 0 || b.floors.some((f) => f.outlines.length > 0)));
  const outdoor = data.checkpoints.filter((c) => c.building === "outdoor");

  // The ground: a faint frame round the campus.
  const allLoops = built.flatMap((b) => b.footprint);
  const campus = allLoops.length > 0 ? bounds(allLoops) : bounds(data.checkpoints.map((c) => [[c.x, c.y] as PlacePoint]));
  const pad = 10;
  const groundBox: Box = { x0: campus.x0 - pad, x1: campus.x1 + pad, y0: campus.y0 - pad, y1: campus.y1 + pad };
  const groundVertices: number[] = [];
  loopSegments(
    [
      [
        [groundBox.x0, groundBox.y0],
        [groundBox.x1, groundBox.y0],
        [groundBox.x1, groundBox.y1],
        [groundBox.x0, groundBox.y1],
      ],
    ],
    0,
    groundVertices,
  );
  const ground = layer(makeMesh(groundVertices), gl.LINES, 0.16);

  const parts = new Map<BuildingId, BuildingPart>();

  for (const b of built) {
    const sorted = [...b.floors].sort((p, q) => p.z - q.z);
    const floors: FloorPart[] = sorted.map((f, index) => {
      const loops = f.outlines.length > 0 ? f.outlines : b.footprint;
      const top = index + 1 < sorted.length ? sorted[index + 1].z : Math.max(b.roofZ, f.z + 3);
      const ringVertices: number[] = [];
      loopSegments(loops, f.z, ringVertices);
      const postVertices: number[] = [];
      for (const loop of loops) for (const [x, y] of loop) postVertices.push(x, f.z, -y, x, top, -y);
      // An outline with a hole (a light well, a gate) is drawn as outline only: ear clipping would fill the hole in.
      const fill = layer(makeMesh(hasHoles(loops) ? [] : loops.flatMap((loop) => triangulate(loop))), gl.TRIANGLES);
      fill.offset = [0, f.z, 0];
      const floorButton = button(panel, "cm__floor", f.label, () => getProps().onFloor(f.label));
      floorButton.setAttribute("aria-label", `${b.name} ${f.label}`);
      return { label: f.label, index, z: f.z, top, loops, ring: layer(makeMesh(ringVertices), gl.LINES), posts: layer(makeMesh(postVertices), gl.LINES), fill, button: floorButton };
    });
    // Highest at the top, as on a lift's panel.
    for (const f of [...floors].reverse()) panel.appendChild(f.button);
    const roofVertices: number[] = [];
    if (floors.length > 0) loopSegments(floors[floors.length - 1].loops, b.roofZ, roofVertices);
    const tag = button(overlay, "cm__label", b.name, () => getProps().onBuilding(b.id));
    tag.setAttribute("aria-label", `${b.name}を選ぶ`);
    const loops = floors.flatMap((f) => f.loops);
    parts.set(b.id, { data: b, floors, roof: layer(makeMesh(roofVertices), gl.LINES), box: bounds(loops.length > 0 ? loops : b.footprint), tag });
  }

  // Landmarks that tell a building from inside: the classroom building's escalators.
  const escalators: EscalatorPart[] = (data.landmarks ?? [])
    .filter((e) => e.kind === "escalator" && parts.has(e.building))
    .map((e) => ({ layer: layer(makeMesh(escalatorLines(e)), gl.LINES), building: e.building, foot: Math.min(e.from[2], e.to[2]), head: Math.max(e.from[2], e.to[2]) }));

  // Checkpoint names: beside their dots on an open floor, and beside the outdoor ones on the whole campus.
  const tags = new Map<string, HTMLButtonElement>();
  for (const c of data.checkpoints) {
    const tag = button(overlay, "cm__tag", c.name, () => getProps().onSelect(c.id));
    tags.set(c.id, tag);
  }

  // Dots: the checkpoints in view, and a ring that pulses on the chosen one.
  const dotBuffer = makeBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Math.max(1, data.checkpoints.length) * 3), gl.DYNAMIC_DRAW);
  const coreBuffer = makeBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, coreBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3), gl.DYNAMIC_DRAW);
  let dotCount = 0;
  let dotSize = 11;
  let ringSize = 44;
  let ringOpacity = 0.9;
  let coreOpacity = 1;
  let chosenOn = false;

  let shown: { checkpoint: Checkpoint; position: V3 }[] = [];
  let chosenPosition: V3 | null = null;

  const campusCenter = at((groundBox.x0 + groundBox.x1) / 2, (groundBox.y0 + groundBox.y1) / 2, 0);
  const view: View = { x: campusCenter[0], y: 0, z: campusCenter[2], dist: 300, yaw: CAMPUS_YAW, pitch: PITCH_CAMPUS };
  let cam = camOf(view);
  let from: View = { ...view };
  let goal: View = { ...view };
  let tweenStart = 0;
  let tweening = false;
  let width = 1;
  let height = 1;
  let raf = 0;
  let pulseRaf = 0;
  let pulseLast = 0;
  let disposed = false;
  /** The whole campus' distance: pinching is measured against it. */
  let baseDist = 300;
  /** The next change of frame jumps instead of gliding (the first one, and any after the frame's shape changed). */
  let snapNext = true;

  /** How far the picture is shifted up (as a share of the height) to sit in what is left above the inset. */
  const shift = (): number => (getProps().insetBottom ?? 0) / height;

  const screenOf = (c: Cam, p: V3, s: number): { x: number; y: number; ok: boolean } => {
    const rel = sub(p, c.pos);
    const depth = dot(rel, c.fwd);
    if (depth <= NEAR) return { x: 0, y: 0, ok: false };
    const nx = dot(rel, c.right) / (depth * TAN_HALF * (width / height));
    const ny = dot(rel, c.up) / (depth * TAN_HALF);
    return { x: ((nx + 1) / 2) * width, y: ((1 - (ny + s)) / 2) * height, ok: true };
  };
  const project = (p: V3) => screenOf(cam, p, shift());

  // Where to put the camera so a set of points fills the frame with room to spare, whatever the frame's shape:
  // the points are projected from a trial camera, which is moved back and re-centred until they just fit.
  type Room = { left: number; right: number; top: number; bottom: number };
  const fit = (points: V3[], yaw: number, pitch: number, share: number, extra: Partial<Room> = {}): View => {
    const inset = getProps().insetBottom ?? 0;
    const usable = Math.max(60, height - inset);
    const room: Room = {
      left: width * share + (extra.left ?? 0),
      right: width * share + (extra.right ?? 0),
      top: usable * share + (extra.top ?? 0),
      bottom: usable * share + (extra.bottom ?? 0),
    };
    const availX = Math.max(40, width - room.left - room.right);
    const availY = Math.max(40, usable - room.top - room.bottom);
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const q of points) {
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i], q[i]);
        hi[i] = Math.max(hi[i], q[i]);
      }
    }
    const target: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    let dist = Math.max(40, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]));
    const s = inset / height;
    for (let i = 0; i < 16; i++) {
      const c = camOf({ x: target[0], y: target[1], z: target[2], dist, yaw, pitch });
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const q of points) {
        const v = screenOf(c, q, s);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
      const scale = Math.min(2, Math.max(0.5, Math.max((x1 - x0) / availX, (y1 - y0) / availY)));
      const dx = (x0 + x1) / 2 - (room.left + availX / 2);
      const dy = (y0 + y1) / 2 - (room.top + availY / 2);
      const pxPerMetre = height / 2 / (dist * TAN_HALF);
      for (let k = 0; k < 3; k++) target[k] += (c.right[k] * dx - c.up[k] * dy) / pxPerMetre;
      dist *= scale;
    }
    return { x: target[0], y: target[1], z: target[2], dist, yaw, pitch };
  };

  /** The fit that shows the points largest, over a few directions (and angles): a portrait frame turns a long campus to stand up in it. */
  const bestFit = (points: V3[], yaws: number[], pitches: number[], share: number, extra: Partial<Room> = {}): View => {
    let best: View | null = null;
    for (const yaw of yaws) for (const pitch of pitches) {
      const v = fit(points, yaw, pitch, share, extra);
      if (!best || v.dist < best.dist) best = v;
    }
    return best ?? fit(points, view.yaw, pitches[0], share, extra);
  };
  const around = (center: number, spread: number, steps: number): number[] =>
    Array.from({ length: steps * 2 + 1 }, (_, i) => center + ((i - steps) / steps) * spread);
  /** The whole campus' direction, chosen when the frame's size is known and kept, so coming back always looks the same. */
  let campusYaw: number | null = null;

  const cornersOf = (b: Box, heights: number[]): V3[] => heights.flatMap((z) => [at(b.x0, b.y0, z), at(b.x1, b.y0, z), at(b.x1, b.y1, z), at(b.x0, b.y1, z)]);

  const matrix = (): Float32Array => {
    const { pos, right, up, fwd } = cam;
    const view4 = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0, -dot(right, pos), -dot(up, pos), dot(fwd, pos), 1];
    const f = 1 / TAN_HALF;
    const proj = [f / (width / height), 0, 0, 0, 0, f, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0];
    const m = multiply(proj, view4);
    const s = shift();
    for (let c = 0; c < 4; c++) m[c * 4 + 1] += s * m[c * 4 + 3];
    return m;
  };

  const renderFrame = () => {
    if (disposed || gl.isContextLost()) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const m = matrix();
    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniform.mvp, false, m);
    const draw = (l: Layer) => {
      if (l.opacity <= 0.005 || l.mesh.count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, l.mesh.buffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3f(lineUniform.off, l.offset[0], l.offset[1], l.offset[2]);
      gl.uniform4f(lineUniform.color, l.color[0], l.color[1], l.color[2], l.opacity);
      gl.drawArrays(l.mode, 0, l.mesh.count);
    };
    fillLayers.forEach(draw);
    lineLayers.forEach(draw);
    gl.useProgram(pointProgram);
    gl.uniformMatrix4fv(pointUniform.mvp, false, m);
    const points = (buffer: WebGLBuffer, count: number, size: number, opacity: number, kind: number) => {
      if (count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(pointUniform.size, size * dpr);
      gl.uniform4f(pointUniform.color, ink[0], ink[1], ink[2], opacity);
      gl.uniform1f(pointUniform.kind, kind);
      gl.drawArrays(gl.POINTS, 0, count);
    };
    points(dotBuffer, dotCount, dotSize, 1, 0);
    if (chosenOn) {
      points(coreBuffer, 1, ringSize, ringOpacity, 1);
      points(coreBuffer, 1, dotSize + 6, coreOpacity, 0);
    }
  };

  const drawNow = () => {
    raf = 0;
    if (disposed) return;
    if (tweening) {
      const t = Math.min(1, (performance.now() - tweenStart) / TWEEN_MS);
      const e = ease(t);
      view.x = from.x + (goal.x - from.x) * e;
      view.y = from.y + (goal.y - from.y) * e;
      view.z = from.z + (goal.z - from.z) * e;
      view.dist = from.dist + (goal.dist - from.dist) * e;
      view.pitch = from.pitch + (goal.pitch - from.pitch) * e;
      let dyaw = goal.yaw - from.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      view.yaw = from.yaw + dyaw * e;
      if (t >= 1) tweening = false;
    }
    cam = camOf(view);
    updateLabels();
    renderFrame();
    if (tweening) request();
  };

  const request = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(drawNow);
  };

  const glide = (to: View) => {
    from = { ...view };
    goal = to;
    if (reduced) {
      Object.assign(view, to);
      tweening = false;
    } else {
      tweenStart = performance.now();
      tweening = true;
    }
    request();
  };

  // Labels are measured once, then kept inside the frame and nudged apart so none hides another.
  const sizes = new WeakMap<HTMLElement, { w: number; h: number }>();
  const sizeOf = (el: HTMLElement): { w: number; h: number } => {
    let size = sizes.get(el);
    if (!size) {
      el.dataset.on = "true";
      size = { w: el.offsetWidth, h: el.offsetHeight };
      sizes.set(el, size);
    }
    return size;
  };

  /** A label to place: its size, and the places it may go (beside its dot or roof), tried in order. */
  type Slot = { el: HTMLElement; w: number; h: number; options: [number, number][] };
  type Rect = { cx: number; cy: number; w: number; h: number };

  const clashes = (a: Rect, b: Rect) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + 1;

  /**
   * Puts each label at the first of its places that is inside the frame and clear of the labels already placed
   * and of every dot (a name never covers a checkpoint). When none is clear, the least crowded one is used.
   */
  const settle = (slots: Slot[], area: Box, dots: Rect[]) => {
    const placed: Rect[] = [...dots];
    for (const slot of slots) {
      let best: Rect | null = null;
      let fewest = Infinity;
      for (const [x, y] of slot.options) {
        const r: Rect = {
          cx: Math.min(area.x1 - slot.w / 2, Math.max(area.x0 + slot.w / 2, x)),
          cy: Math.min(area.y1 - slot.h / 2, Math.max(area.y0 + slot.h / 2, y)),
          w: slot.w,
          h: slot.h,
        };
        const crowd = placed.filter((o) => clashes(o, r)).length + (r.cx !== x || r.cy !== y ? 0.5 : 0);
        if (crowd < fewest) {
          fewest = crowd;
          best = r;
        }
        if (crowd === 0) break;
      }
      if (!best) continue;
      placed.push(best);
      slot.el.dataset.on = "true";
      slot.el.style.transform = `translate3d(${(best.cx - best.w / 2).toFixed(1)}px,${(best.cy - best.h / 2).toFixed(1)}px,0)`;
    }
  };

  /** Places round a point for a label of this size: right, left, above, below, then the corners. */
  const around8 = (x: number, y: number, w: number, h: number, gap: number): [number, number][] => [
    [x + gap + w / 2, y],
    [x - gap - w / 2, y],
    [x, y - gap - h / 2],
    [x, y + gap + h / 2],
    [x + gap + w / 2, y - h - 2],
    [x + gap + w / 2, y + h + 2],
    [x - gap - w / 2, y - h - 2],
    [x - gap - w / 2, y + h + 2],
  ];

  const updateLabels = () => {
    const p = getProps();
    const usable = Math.max(60, height - (p.insetBottom ?? 0));
    const open = p.building ? parts.get(p.building) : undefined;
    // Inside the frame, clear of the way back (top left) and the floor buttons (right).
    const area: Box = { x0: 4, x1: width - (open ? PANEL_ROOM : 4), y0: open ? BACK_ROOM : 4, y1: usable - 4 };
    const slots: Slot[] = [];
    for (const part of parts.values()) {
      part.tag.dataset.on = "false";
      if (open) continue;
      const q = project(at(part.data.labelAt[0], part.data.labelAt[1], part.data.roofZ + 3));
      if (!q.ok) continue;
      const size = sizeOf(part.tag);
      // Above the roof first; the building's name may move round it but stays by its building.
      slots.push({ el: part.tag, ...size, options: [[q.x, q.y - size.h / 2 - 2], ...around8(q.x, q.y, size.w, size.h, 6)] });
    }
    const dots: Rect[] = [];
    for (const tag of tags.values()) tag.dataset.on = "false";
    const named: Slot[] = [];
    for (const item of shown) {
      const q = project(item.position);
      if (!q.ok) continue;
      dots.push({ cx: q.x, cy: q.y, w: 18, h: 18 });
      if (open && p.floor === null) continue;
      const tag = tags.get(item.checkpoint.id);
      if (!tag) continue;
      const chosen = item.checkpoint.id === p.selectedId;
      tag.setAttribute("aria-pressed", String(chosen));
      // On the whole campus the outdoor names are short and small until one is chosen.
      const small = !open && !chosen;
      const text = small ? shortName(item.checkpoint.name) : item.checkpoint.name;
      if (tag.textContent !== text || tag.dataset.small !== String(small)) {
        tag.textContent = text;
        tag.dataset.small = String(small);
        sizes.delete(tag);
      }
      const size = sizeOf(tag);
      // Close beside the dot first; a little farther out when all the near places are taken.
      const slot: Slot = { el: tag, ...size, options: [...around8(q.x, q.y, size.w, size.h, 14), ...around8(q.x, q.y, size.w, size.h, 34)] };
      // The chosen one's name goes first, so it gets the best place.
      if (chosen) named.unshift(slot);
      else named.push(slot);
    }
    // On an open floor the checkpoints' names matter most; on the whole campus the buildings' do.
    settle(open ? [...named, ...slots] : [...slots, ...named], area, dots);
  };

  const campusFrame = (): View => {
    const points = built.flatMap((b) => cornersOf(bounds(b.footprint.length > 0 ? b.footprint : b.floors.flatMap((f) => f.outlines)), [0, b.roofZ]));
    for (const c of outdoor) points.push(at(c.x, c.y, c.z));
    if (campusYaw === null) {
      // Around the view from the south-east, where the campus's buildings stand apart and read by their shapes.
      const v = bestFit(points, around(CAMPUS_YAW, Math.PI / 5, 3), [PITCH_CAMPUS], MARGIN_CAMPUS, { top: 20 });
      campusYaw = v.yaw;
      return v;
    }
    return bestFit(points, [campusYaw], [PITCH_CAMPUS], MARGIN_CAMPUS, { top: 20 });
  };

  const frameOf = (p: CampusMapProps): View => {
    const part = p.building ? parts.get(p.building) : undefined;
    if (!part) {
      const v = campusFrame();
      baseDist = v.dist;
      return v;
    }
    const room = { right: PANEL_ROOM, top: BACK_ROOM - 12 };
    const index = part.floors.findIndex((f) => f.label === p.floor);
    // A building: turned a little (never more than 60 degrees from where the camera is) so it fills the frame.
    if (index < 0) return bestFit(cornersOf(part.box, [0, part.data.roofZ]), around(view.yaw, Math.PI / 3, 4), [PITCH_BUILDING], MARGIN_BUILDING, room);
    // A floor: seen from above at an angle, near enough to read, with a little height for the dots and names.
    const f = part.floors[index];
    return fit(cornersOf(part.box, [f.z, f.z + 3]), view.yaw, PITCH_FLOOR, MARGIN_BUILDING, room);
  };

  let lastFrameKey = "";
  let lastFloorKey = "";

  const apply = () => {
    const p = getProps();
    const open = p.building ? parts.get(p.building) : undefined;
    const openIndex = open ? open.floors.findIndex((f) => f.label === p.floor) : -1;

    // Buildings: the whole campus in dark enough ink to stand out from the paper; one chosen in full ink, the rest
    // faded back but still readable; with a floor open, the floors above and below stay visible in lighter ink.
    // Every floor is laid with a little paper, so the light and the grid behind the map do not show through.
    for (const part of parts.values()) {
      const chosen = part === open;
      const faded = open !== undefined && !chosen;
      part.roof.opacity = faded ? 0.36 : chosen ? (openIndex >= 0 ? 0.3 : 0.9) : 0.85;
      for (const f of part.floors) {
        f.fill.color = paper;
        f.fill.opacity = faded ? 0.22 : chosen && openIndex >= 0 && f.index > openIndex ? 0.12 : 0.32;
        if (faded) {
          f.ring.opacity = 0.36;
          f.posts.opacity = 0.28;
        } else if (!chosen) {
          f.ring.opacity = 0.72;
          f.posts.opacity = 0.6;
        } else if (openIndex < 0) {
          f.ring.opacity = 0.8;
          f.posts.opacity = 0.55;
        } else if (f.index < openIndex) {
          f.ring.opacity = 0.55;
          f.posts.opacity = 0.42;
        } else if (f.index === openIndex) {
          f.ring.opacity = 1;
          f.posts.opacity = 0.5;
          f.fill.color = ink;
          f.fill.opacity = 0.18;
        } else {
          f.ring.opacity = 0.3;
          f.posts.opacity = 0.24;
        }
      }
    }
    ground.opacity = open ? 0.14 : 0.16;

    // Escalators: seen on the whole campus; inside their building in full ink; with a floor open, the ones that reach it strongest.
    const openFloor = open && openIndex >= 0 ? open.floors[openIndex] : null;
    for (const e of escalators) {
      if (!open) e.layer.opacity = 0.7;
      else if (e.building !== open.data.id) e.layer.opacity = 0.22;
      else if (!openFloor) e.layer.opacity = 0.9;
      else if (Math.abs(e.foot - openFloor.z) < 0.8 || Math.abs(e.head - openFloor.z) < 0.8) e.layer.opacity = 1;
      else e.layer.opacity = e.head <= openFloor.z ? 0.45 : 0.22;
    }

    // The floor buttons and the way back, only inside a building.
    back.dataset.on = open ? "true" : "false";
    crumb.dataset.on = open ? "true" : "false";
    crumb.textContent = open ? open.data.name : "";
    panel.dataset.on = open ? "true" : "false";
    for (const part of parts.values()) {
      for (const f of part.floors) {
        f.button.hidden = part !== open;
        f.button.setAttribute("aria-pressed", String(part === open && f.label === p.floor));
      }
    }
    const floorKey = `${p.building ?? ""}|${p.floor ?? ""}`;
    if (open && floorKey !== lastFloorKey) {
      // Keep the chosen floor's button in view in the column.
      const f = open.floors[openIndex];
      if (f) {
        const top = f.button.offsetTop - panel.clientHeight / 2 + f.button.offsetHeight / 2;
        panel.scrollTop = Math.max(0, top);
      } else panel.scrollTop = 0;
    }
    lastFloorKey = floorKey;

    // Checkpoints: the outdoor ones on the whole campus; on an open floor, its own (a bridge's in both buildings).
    const list: { checkpoint: Checkpoint; position: V3 }[] = [];
    if (!open) {
      for (const c of outdoor) list.push({ checkpoint: c, position: at(c.x, c.y, c.z + 0.4) });
    } else if (openIndex >= 0) {
      const f = open.floors[openIndex];
      for (const c of data.checkpoints) {
        if (c.floor !== f.label || (c.building !== open.data.id && c.joins !== open.data.id)) continue;
        list.push({ checkpoint: c, position: at(c.x, c.y, f.z + 0.5) });
      }
    }
    shown = list;
    const positions = new Float32Array(Math.max(1, list.length) * 3);
    list.forEach((item, i) => positions.set(item.position, i * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    dotCount = list.length;
    dotSize = 16;

    const chosen = list.find((item) => item.checkpoint.id === p.selectedId);
    chosenPosition = chosen ? chosen.position : null;
    if (chosenPosition) {
      gl.bindBuffer(gl.ARRAY_BUFFER, coreBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(chosenPosition));
    }
    chosenOn = chosenPosition !== null;
    startPulse();

    // Only a change of building or floor moves the camera; a tap on a dot does not.
    const key = `${floorKey}|${p.insetBottom ?? 0}|${width}x${height}`;
    if (key !== lastFrameKey) {
      lastFrameKey = key;
      const next = frameOf(p);
      if (snapNext) {
        Object.assign(view, next);
        goal = { ...next };
        tweening = false;
        snapNext = false;
      } else glide(next);
    }
    request();
  };

  function startPulse() {
    if (!chosenOn && pulseRaf) {
      cancelAnimationFrame(pulseRaf);
      pulseRaf = 0;
    }
    if (reduced || disposed || pulseRaf || !chosenOn) return;
    const step = (now: number) => {
      pulseRaf = 0;
      if (disposed || !chosenOn) return;
      if (!document.hidden && now - pulseLast >= PULSE_INTERVAL) {
        pulseLast = now;
        const wave = (Math.sin(now / 340) + 1) / 2;
        ringSize = 38 + wave * 14;
        ringOpacity = 0.45 + (1 - wave) * 0.5;
        coreOpacity = 0.85 + wave * 0.15;
        renderFrame();
      }
      pulseRaf = requestAnimationFrame(step);
    };
    pulseRaf = requestAnimationFrame(step);
  }

  const resize = () => {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    lastFrameKey = "";
    snapNext = true;
    campusYaw = null;
    apply();
  };

  // ---- Gestures: one finger turns, two fingers zoom, a short touch is a tap.
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { startX: number; startY: number; startTime: number; moved: boolean; pinch: number } | null = null;

  const local = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const pinchDistance = (): number => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, local(event));
    const at0 = local(event);
    gesture = { startX: at0.x, startY: at0.y, startTime: performance.now(), moved: pointers.size > 1, pinch: pointers.size === 2 ? pinchDistance() : 0 };
  };

  const onMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous || !gesture) return;
    const next = local(event);
    pointers.set(event.pointerId, next);
    if (pointers.size >= 2) {
      const d = pinchDistance();
      if (gesture.pinch > 0) view.dist = Math.min(baseDist * 1.4, Math.max(baseDist * 0.06, (view.dist * gesture.pinch) / d));
      gesture.pinch = d;
      gesture.moved = true;
      tweening = false;
      request();
      return;
    }
    if (!gesture.moved && Math.hypot(next.x - gesture.startX, next.y - gesture.startY) < TAP_SLOP) return;
    // A drag takes the camera from a glide; a tap during one lets it finish.
    gesture.moved = true;
    tweening = false;
    view.yaw -= (next.x - previous.x) * 0.0065;
    view.pitch = Math.min((80 * Math.PI) / 180, Math.max((18 * Math.PI) / 180, view.pitch + (next.y - previous.y) * 0.0045));
    request();
  };

  /** Where the ray through a pixel meets the horizontal plane at height h, and how far along the ray. */
  const rayAt = (x: number, y: number, h: number): { point: PlacePoint; d: number } | null => {
    const nx = (x / width) * 2 - 1;
    const ny = -(y / height) * 2 + 1 - shift();
    const sx = nx * TAN_HALF * (width / height);
    const sy = ny * TAN_HALF;
    const dir = unit([cam.fwd[0] + cam.right[0] * sx + cam.up[0] * sy, cam.fwd[1] + cam.right[1] * sx + cam.up[1] * sy, cam.fwd[2] + cam.right[2] * sx + cam.up[2] * sy]);
    if (Math.abs(dir[1]) < 1e-6) return null;
    const t = (h - cam.pos[1]) / dir[1];
    if (t <= 0) return null;
    return { point: [cam.pos[0] + dir[0] * t, -(cam.pos[2] + dir[2] * t)], d: t };
  };

  /** The building (and floor) a tap falls in: the first floor plate, roof or footprint the ray passes through. */
  const buildingAt = (x: number, y: number, only?: BuildingPart): { part: BuildingPart; floor: FloorPart | null; d: number } | null => {
    let best: { part: BuildingPart; floor: FloorPart | null; d: number } | null = null;
    for (const part of only ? [only] : parts.values()) {
      const levels: { z: number; loops: PlacePoint[][]; floor: FloorPart | null }[] = part.floors.map((f) => ({ z: f.z, loops: f.loops, floor: f }));
      if (part.floors.length > 0) levels.push({ z: part.data.roofZ, loops: part.floors[part.floors.length - 1].loops, floor: null });
      // The walls between levels count too: test halfway up each storey.
      for (const f of part.floors) levels.push({ z: (f.z + f.top) / 2, loops: f.loops, floor: f });
      for (const level of levels) {
        const r = rayAt(x, y, level.z);
        if (!r || !insideLoops(r.point, level.loops)) continue;
        if (!best || r.d < best.d) best = { part, floor: level.floor, d: r.d };
      }
    }
    return best;
  };

  const tap = (x: number, y: number) => {
    const p = getProps();
    // A checkpoint dot first: the nearest one within reach of the finger.
    let near: { id: string; d: number } | null = null;
    for (const item of shown) {
      const q = project(item.position);
      if (!q.ok) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d <= PICK_RADIUS && (!near || d < near.d)) near = { id: item.checkpoint.id, d };
    }
    const open = p.building ? parts.get(p.building) : undefined;
    if (!open) {
      // A dot within reach of the finger is chosen before the building behind it.
      if (near) {
        p.onSelect(near.id);
        return;
      }
      const hit = buildingAt(x, y);
      if (hit) p.onBuilding(hit.part.data.id);
      return;
    }
    if (near) {
      p.onSelect(near.id);
      return;
    }
    // Inside a building: a tap on one of its storeys opens that floor (the floors above an open one are out of the way).
    const openIndex = open.floors.findIndex((f) => f.label === p.floor);
    const levels = openIndex >= 0 ? { ...open, floors: open.floors.slice(0, openIndex + 1) } : open;
    const inside = buildingAt(x, y, levels);
    if (inside?.floor && inside.floor.label !== p.floor) {
      p.onFloor(inside.floor.label);
      return;
    }
    if (!inside) {
      const other = buildingAt(x, y);
      if (other && other.part !== open) p.onBuilding(other.part.data.id);
    }
  };

  const onUp = (event: PointerEvent) => {
    const wasTap = gesture !== null && !gesture.moved && performance.now() - gesture.startTime < 600 && pointers.size === 1;
    const at1 = local(event);
    pointers.delete(event.pointerId);
    if (pointers.size === 0) {
      if (wasTap) tap(at1.x, at1.y);
      gesture = null;
    } else if (gesture) {
      gesture.pinch = pointers.size === 2 ? pinchDistance() : 0;
    }
  };

  // A touch the system took over (a call, a gesture) is not a tap.
  const onCancel = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size === 0) gesture = null;
    else if (gesture) gesture.pinch = pointers.size === 2 ? pinchDistance() : 0;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    view.dist = Math.min(baseDist * 1.4, Math.max(baseDist * 0.06, view.dist * Math.exp(event.deltaY * 0.0012)));
    tweening = false;
    request();
  };

  const onLost = (event: Event) => {
    event.preventDefault();
    getProps().onUnavailable();
  };

  // Safari would otherwise zoom the page itself on a pinch.
  const noGesture = (event: Event) => event.preventDefault();

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("gesturestart", noGesture);
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const onVisible = () => {
    if (!document.hidden) {
      startPulse();
      request();
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  resize();

  return {
    apply,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(pulseRaf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("gesturestart", noGesture);
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      gl.deleteProgram(lineProgram);
      gl.deleteProgram(pointProgram);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
      overlay.remove();
      back.remove();
      crumb.remove();
      panel.remove();
    },
  };
}
