"use client";

import { useEffect, useRef } from "react";

import type { Building, BuildingId, Checkpoint, PlacePoint, PlacesData } from "@/lib/places/types";
import { LINE_FRAGMENT, LINE_VERTEX, POINT_FRAGMENT, POINT_VERTEX, compileProgram, getContext } from "@/lib/places/webgl";

import "./campus-map.css";

/**
 * The map a participant picks a photo's place on: a few kilobytes of outlines
 * drawn as thin lines, never a model, and no 3D library either (a hand-made
 * WebGL: two tiny shaders, flat colour). Seen from above, each building is its
 * outline and roof line; tapping one pulls it apart into its floors, stacked
 * like plates; tapping a floor lays its plate down thinly and lights the
 * checkpoints on it. Rooms are not drawn at all.
 *
 * It is light on purpose: no antialiasing, pixel ratio at most 1.5, and a
 * frame is drawn only while something moves (dragging, pinching, a camera
 * glide) or while the chosen checkpoint's ring is pulsing (twenty frames a
 * second, none when the person prefers less motion or the tab is hidden).
 */

export type CampusMapProps = {
  data: PlacesData;
  building: BuildingId | null;
  floor: string | null;
  selectedId: string | null;
  onBuilding: (id: BuildingId | null) => void;
  onFloor: (label: string) => void;
  onSelect: (id: string) => void;
  /** Called when WebGL cannot run (none, or the context was lost): the caller shows a list instead. */
  onUnavailable: () => void;
  /** Pixels at the bottom covered by a sheet; the picture is centred in what is left. */
  insetBottom?: number;
  className?: string;
};

/** Height between plates once a building is pulled apart: equal for every floor, and wider for a wider building so the plates stay apart on screen. */
const MIN_GAP = 5;
const MAX_GAP = 8;
const FOV = 36;
const TAN_HALF = Math.tan((FOV * Math.PI) / 360);
const NEAR = 1;
const FAR = 4000;
const DOT = 11;
/** Moving this far (px) turns a touch into a drag: it is not a tap. */
const TAP_SLOP = 8;
/** A checkpoint takes a tap within this many px of its dot: a 48px invisible target around a dot that is drawn small. */
const PICK_RADIUS = 24;
const TWEEN_MS = 300;
const PULSE_INTERVAL = 50;
const LABEL_SPACING = 18;
/** Room kept round the picture, as a share of the frame. */
const MARGIN = 0.08;

const BUILDING_LINE = 0.62;
const BUILDING_FADED = 0.14;

type V3 = [number, number, number];
type View = { x: number; y: number; z: number; dist: number; yaw: number; pitch: number };
type Cam = { pos: V3; right: V3; up: V3; fwd: V3 };
type Mesh = { buffer: WebGLBuffer; count: number };

/** Something drawn with one of the two programs: a buffer, how, and how strongly. */
type Layer = { mesh: Mesh; mode: number; offset: V3; opacity: number; visible: boolean };

type FloorGroup = {
  label: string;
  index: number;
  lines: Layer;
  fill: Layer;
  /** Plate vertices, for placing the floor's label. */
  anchors: V3[];
  button: HTMLButtonElement;
};

type BuildingGroup = {
  data: Building;
  overview: Layer;
  guides: Layer;
  floors: FloorGroup[];
  center: V3;
  radius: number;
  /** Half the footprint's diagonal: how much of the ground a floor takes up. */
  footRadius: number;
  /** Height between this building's plates once it is pulled apart. */
  gap: number;
  /** The plates' extent on the ground, in campus metres. */
  box: Box;
  button: HTMLButtonElement;
  /** Outline loop used to find which building a tap fell on. */
  hit: PlacePoint[];
};

type Box = { x0: number; x1: number; y0: number; y1: number };

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

function largestLoop(loops: PlacePoint[][]): PlacePoint[] {
  let best: PlacePoint[] = [];
  let area = -1;
  for (const loop of loops) {
    const b = bounds([loop]);
    const a = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (a > area) {
      area = a;
      best = loop;
    }
  }
  return best;
}

function rectLoop(b: Box): PlacePoint[] {
  return [
    [b.x0, b.y0],
    [b.x1, b.y0],
    [b.x1, b.y1],
    [b.x0, b.y1],
  ];
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

function readInk(host: HTMLElement): V3 {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;color:var(--fg,#0c0c0d)";
  host.appendChild(probe);
  const numbers = getComputedStyle(probe).color.match(/[\d.]+/g);
  host.removeChild(probe);
  return numbers && numbers.length >= 3 ? [Number(numbers[0]) / 255, Number(numbers[1]) / 255, Number(numbers[2]) / 255] : [0.047, 0.047, 0.05];
}

function label(host: HTMLElement, className: string, text: string, onTap: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `cm__label ${className}`;
  button.textContent = text;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onTap();
  });
  // A tap on a label is not the start of a drag on the map.
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  host.appendChild(button);
  return button;
}

function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ---------------------------------------------------------------------------

function createEngine(host: HTMLDivElement, data: PlacesData, getProps: () => CampusMapProps): Engine {
  const ink = readInk(host);
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
  const tag = document.createElement("div");
  tag.className = "cm__tag";
  overlay.appendChild(tag);

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
  const layers: Layer[] = [];
  const layer = (mesh: Mesh, mode: number, opacity: number, visible = true): Layer => {
    const l: Layer = { mesh, mode, offset: [0, 0, 0], opacity, visible };
    layers.push(l);
    return l;
  };

  // The campus' frame: outlines of every building and the ground they sit on.
  const allFootprints = data.buildings.flatMap((b) => b.footprint);
  const box = allFootprints.length > 0 ? bounds(allFootprints) : bounds(data.checkpoints.map((c) => [[c.x, c.y] as PlacePoint]));
  const pad = 14;
  const campusBox: Box = { x0: box.x0 - pad, x1: box.x1 + pad, y0: box.y0 - pad, y1: box.y1 + pad };
  const campusLoop = rectLoop(campusBox);
  const campusCenter = at((campusBox.x0 + campusBox.x1) / 2, (campusBox.y0 + campusBox.y1) / 2, 0);

  const groundVertices: number[] = [];
  loopSegments([campusLoop], 0, groundVertices);
  layer(makeMesh(groundVertices), gl.LINES, 0.22);

  // Floors with the same outline (most of a tall building) share one buffer, moved up by the plate's height.
  const plateMeshes = new Map<string, { lines: Mesh; fill: Mesh }>();
  const plateOf = (outlines: PlacePoint[][]): { lines: Mesh; fill: Mesh } => {
    const key = JSON.stringify(outlines);
    let found = plateMeshes.get(key);
    if (!found) {
      const seg: number[] = [];
      loopSegments(outlines, 0, seg);
      found = { lines: makeMesh(seg), fill: makeMesh(outlines.flatMap((loop) => triangulate(loop))) };
      plateMeshes.set(key, found);
    }
    return found;
  };

  const groups = new Map<BuildingId, BuildingGroup>();

  const activate = (id: BuildingId) => {
    const p = getProps();
    p.onBuilding(p.building === id ? null : id);
  };

  for (const b of data.buildings) {
    const loops = b.footprint;
    const plates = b.id === "outdoor" && loops.length === 0 ? [campusLoop] : loops;
    const bb = plates.length > 0 ? bounds(plates) : campusBox;
    const footRadius = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0) / 2;
    const gap = Math.min(MAX_GAP, Math.max(MIN_GAP, footRadius * 0.17));
    const stackHeight = Math.max(1, b.floors.length) * gap;
    const center = at((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, stackHeight / 2);
    const radius = Math.hypot(bb.x1 - bb.x0, bb.y1 - bb.y0, stackHeight) / 2;

    // Seen from above: the footprint, the roof line, and a few uprights.
    const ov: number[] = [];
    if (b.id !== "outdoor") {
      loopSegments(loops, 0, ov);
      loopSegments(loops, b.roofZ, ov);
      for (const loop of loops) {
        const step = Math.max(1, Math.ceil(loop.length / 10));
        for (let i = 0; i < loop.length; i += step) ov.push(loop[i][0], 0, -loop[i][1], loop[i][0], b.roofZ, -loop[i][1]);
      }
    }
    const overview = layer(makeMesh(ov), gl.LINES, BUILDING_LINE);

    const gd: number[] = [];
    const top = (b.floors.length - 1) * gap;
    for (const loop of plates) {
      const step = Math.max(1, Math.ceil(loop.length / 8));
      for (let i = 0; i < loop.length; i += step) gd.push(loop[i][0], 0, -loop[i][1], loop[i][0], top, -loop[i][1]);
    }
    const guides = layer(makeMesh(gd), gl.LINES, 0.18, false);

    const floors: FloorGroup[] = b.floors.map((f, index) => {
      const outlines = f.outlines.length > 0 ? f.outlines : plates;
      const plate = plateOf(outlines);
      const lines = layer(plate.lines, gl.LINES, 0.55, false);
      lines.offset = [0, index * gap, 0];
      const fill = layer(plate.fill, gl.TRIANGLES, 0.1, false);
      fill.offset = [0, index * gap, 0];

      const anchors: V3[] = [];
      for (const loop of outlines) {
        const step = Math.max(1, Math.ceil(loop.length / 16));
        for (let i = 0; i < loop.length; i += step) anchors.push(at(loop[i][0], loop[i][1], index * gap));
      }
      if (anchors.length === 0) anchors.push(at(b.labelAt[0], b.labelAt[1], index * gap));
      const button = label(overlay, "cm__label--floor", f.label, () => getProps().onFloor(f.label));
      button.setAttribute("aria-label", `${b.name} ${f.label}`);
      return { label: f.label, index, lines, fill, anchors, button };
    });

    const button = label(overlay, "cm__label--building", b.name, () => activate(b.id));
    button.setAttribute("aria-label", `${b.name}を選ぶ`);
    groups.set(b.id, { data: b, overview, guides, floors, center, radius, footRadius, gap, box: bb, button, hit: largestLoop(loops) });
  }

  // Checkpoints: lit dots, and a ring that pulses on the chosen one.
  const maxDots = Math.max(1, data.checkpoints.length);
  const dotBuffer = makeBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(maxDots * 3), gl.DYNAMIC_DRAW);
  const coreBuffer = makeBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, coreBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3), gl.DYNAMIC_DRAW);
  let dotCount = 0;
  let dotSize = DOT;
  let dotOpacity = 1;
  let ringSize = 40;
  let ringOpacity = 0.9;
  let coreOpacity = 1;
  let chosenOn = false;

  let shown: { checkpoint: Checkpoint; position: V3 }[] = [];
  let selectedPosition: V3 | null = null;
  let selectedName = "";

  // The view: where the camera orbits and from how far.
  const view: View = { x: campusCenter[0], y: 0, z: campusCenter[2], dist: 300, yaw: 0.35, pitch: (50 * Math.PI) / 180 };
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
  /** The distance of the whole-campus view: pinching is measured against it. */
  let baseDist = 300;
  /** The next change of frame jumps instead of gliding (the first one, and any after the frame's shape changed). */
  let snapNext = true;

  /** How far the picture is shifted up (as a share of the height) to sit in what a sheet at the bottom leaves. */
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

  // Where to put the camera so a set of points fills the frame with MARGIN to spare, whatever the frame's shape:
  // the points are projected from a trial camera and it is moved back and re-centred until they just fit.
  type Margin = { left: number; right: number; top: number; bottom: number };
  const fit = (points: V3[], yaw: number, pitch: number, extra: Partial<Margin> = {}): { x: number; y: number; z: number; dist: number } => {
    const inset = getProps().insetBottom ?? 0;
    const usable = Math.max(60, height - inset);
    const margin: Margin = {
      left: width * MARGIN + (extra.left ?? 0),
      right: width * MARGIN + (extra.right ?? 0),
      top: usable * MARGIN + (extra.top ?? 0),
      bottom: usable * MARGIN + (extra.bottom ?? 0),
    };
    const availX = Math.max(40, width - margin.left - margin.right);
    const availY = Math.max(40, usable - margin.top - margin.bottom);
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
    for (let i = 0; i < 14; i++) {
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
      const dx = (x0 + x1) / 2 - (margin.left + availX / 2);
      const dy = (y0 + y1) / 2 - (margin.top + availY / 2);
      const pxPerMetre = height / 2 / (dist * TAN_HALF);
      for (let k = 0; k < 3; k++) target[k] += (c.right[k] * dx - c.up[k] * dy) / pxPerMetre;
      dist *= scale;
    }
    return { x: target[0], y: target[1], z: target[2], dist };
  };

  const cornersOf = (b: Box, heights: number[]): V3[] => heights.flatMap((z) => [at(b.x0, b.y0, z), at(b.x1, b.y0, z), at(b.x1, b.y1, z), at(b.x0, b.y1, z)]);

  const matrix = (): Float32Array => {
    const { pos, right, up, fwd } = cam;
    const view4 = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0, -dot(right, pos), -dot(up, pos), dot(fwd, pos), 1];
    const f = 1 / TAN_HALF;
    const aspect = width / height;
    const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0];
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
    for (const l of layers) {
      if (!l.visible || l.mesh.count === 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, l.mesh.buffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3f(lineUniform.off, l.offset[0], l.offset[1], l.offset[2]);
      gl.uniform4f(lineUniform.color, ink[0], ink[1], ink[2], l.opacity);
      gl.drawArrays(l.mode, 0, l.mesh.count);
    }
    gl.useProgram(pointProgram);
    gl.uniformMatrix4fv(pointUniform.mvp, false, m);
    const drawPoints = (buffer: WebGLBuffer, count: number, size: number, opacity: number, kind: number) => {
      if (count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(pointUniform.size, size * dpr);
      gl.uniform4f(pointUniform.color, ink[0], ink[1], ink[2], opacity);
      gl.uniform1f(pointUniform.kind, kind);
      gl.drawArrays(gl.POINTS, 0, count);
    };
    drawPoints(dotBuffer, dotCount, dotSize, dotOpacity, 0);
    if (chosenOn) {
      drawPoints(coreBuffer, 1, ringSize, ringOpacity, 1);
      drawPoints(coreBuffer, 1, 16, coreOpacity, 0);
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

  const floorIndex = (b: BuildingGroup, label: string | null): number => (label === null ? -1 : b.floors.findIndex((f) => f.label === label));

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

  type Slot = { el: HTMLElement; cx: number; cy: number; w: number; h: number; pinned: boolean };

  const settle = (slots: Slot[], usable: number) => {
    const placed: Slot[] = [];
    for (const slot of slots) {
      if (!slot.pinned) {
        // Under whatever is already there, a few tries at most.
        for (let pass = 0; pass < 8; pass++) {
          const clash = placed.find((o) => Math.abs(o.cx - slot.cx) < (o.w + slot.w) / 2 + 2 && Math.abs(o.cy - slot.cy) < (o.h + slot.h) / 2 + 1);
          if (!clash) break;
          slot.cy = clash.cy + (clash.h + slot.h) / 2 + 2;
        }
      }
      slot.cx = Math.min(width - slot.w / 2 - 4, Math.max(slot.w / 2 + 4, slot.cx));
      slot.cy = Math.min(usable - slot.h / 2 - 4, Math.max(slot.h / 2 + 4, slot.cy));
      placed.push(slot);
      slot.el.style.transform = `translate3d(${(slot.cx - slot.w / 2).toFixed(1)}px,${(slot.cy - slot.h / 2).toFixed(1)}px,0)`;
    }
  };

  const updateLabels = () => {
    const p = getProps();
    const usable = Math.max(60, height - (p.insetBottom ?? 0));
    const selected = p.building ? groups.get(p.building) : undefined;
    const pinned: Slot[] = [];
    const loose: Slot[] = [];
    for (const g of groups.values()) {
      const isSelected = g === selected;
      const anchor: V3 = isSelected ? [g.center[0], g.floors.length * g.gap + 1.5, g.center[2]] : at(g.data.labelAt[0], g.data.labelAt[1], selected ? 0 : g.data.labelAt[2]);
      const s = project(anchor);
      g.button.dataset.dim = selected && !isSelected ? "true" : "false";
      g.button.setAttribute("aria-pressed", String(isSelected));
      if (s.ok) {
        const size = sizeOf(g.button);
        (isSelected ? pinned : loose).push({ el: g.button, cx: s.x, cy: s.y, ...size, pinned: isSelected });
      } else g.button.dataset.on = "false";
      // Plates close together on screen would hide each other's labels: show every n-th, and the open floor.
      let every = 1;
      if (isSelected && g.floors.length > 1) {
        const a = project(g.floors[0].anchors[0]);
        const b2 = project(g.floors[1].anchors[0]);
        every = Math.max(1, Math.ceil(LABEL_SPACING / Math.max(1, Math.abs(a.y - b2.y))));
      }
      const last = g.floors.length - 1;
      for (const f of g.floors) {
        // Counted down from the top floor, so the top is always named.
        const on = isSelected && ((last - f.index) % every === 0 || f.label === p.floor);
        f.button.dataset.on = on ? "true" : "false";
        if (!on) continue;
        let best = { x: -Infinity, y: 0 };
        for (const a of f.anchors) {
          const q = project(a);
          if (q.ok && q.x > best.x) best = q;
        }
        f.button.setAttribute("aria-pressed", String(f.label === p.floor));
        const size = sizeOf(f.button);
        pinned.push({ el: f.button, cx: best.x + 10 + size.w / 2, cy: best.y, ...size, pinned: true });
      }
    }
    loose.sort((a, b) => a.cy - b.cy);
    settle([...pinned, ...loose], usable);

    if (selectedPosition && selectedName) {
      const q = project(selectedPosition);
      tag.dataset.on = q.ok ? "true" : "false";
      if (tag.textContent !== selectedName) {
        tag.textContent = selectedName;
        sizes.delete(tag);
      }
      const size = sizeOf(tag);
      // Beside the dot, on the side with room, and never outside the frame.
      const right = q.x < width * 0.5;
      const cx = right ? q.x + 14 + size.w / 2 : q.x - 14 - size.w / 2;
      const cy = q.y - 26;
      const x = Math.min(width - size.w - 4, Math.max(4, cx - size.w / 2));
      const y = Math.min(usable - size.h - 4, Math.max(4, cy - size.h / 2));
      tag.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    } else {
      tag.dataset.on = "false";
    }
  };

  const overviewFit = (extraTop: number): View => {
    const built = data.buildings.filter((b) => b.id !== "outdoor" && b.footprint.length > 0);
    const points = built.flatMap((b) => cornersOf(bounds(b.footprint), [0, b.roofZ]));
    if (points.length === 0) points.push(...cornersOf(campusBox, [0]));
    const pitch = (50 * Math.PI) / 180;
    return { ...fit(points, view.yaw, pitch, { top: extraTop }), yaw: view.yaw, pitch };
  };

  const frameOf = (p: CampusMapProps): View => {
    const b = p.building ? groups.get(p.building) : undefined;
    if (!b || b.data.id === "outdoor") {
      const v = overviewFit(22);
      baseDist = v.dist;
      return v;
    }
    const top = (b.floors.length - 1) * b.gap;
    // Room on the right for the floor labels and above for the building's name.
    const room = { right: 48, top: 26 };
    const pitchAll = (38 * Math.PI) / 180;
    const pitchFloor = (46 * Math.PI) / 180;
    const middle = at((b.box.x0 + b.box.x1) / 2, (b.box.y0 + b.box.y1) / 2, top + b.gap);
    const all = fit([...cornersOf(b.box, [0, top]), middle], view.yaw, pitchAll, room);
    const index = floorIndex(b, p.floor);
    if (index < 0) return { ...all, yaw: view.yaw, pitch: pitchAll };
    // An open floor: a little nearer than the whole building, but never so near its plate is cut off.
    const plate = fit(cornersOf(b.box, [index * b.gap]), view.yaw, pitchFloor, room);
    const dist = Math.min(all.dist, Math.max(plate.dist, all.dist * 0.78));
    return { x: plate.x, y: plate.y, z: plate.z, dist, yaw: view.yaw, pitch: pitchFloor };
  };

  let lastFrameKey = "";

  const apply = () => {
    const p = getProps();
    const selected = p.building ? groups.get(p.building) : undefined;
    const exploded = selected !== undefined && selected.data.id !== "outdoor";

    // Buildings: whole when seen from above, faded behind the one being looked into.
    for (const g of groups.values()) {
      const isSelected = g === selected;
      g.overview.visible = !(isSelected && exploded);
      g.overview.opacity = selected && !isSelected ? BUILDING_FADED : BUILDING_LINE;
      g.guides.visible = isSelected && exploded;
      for (const f of g.floors) {
        const show = isSelected && (exploded || g.data.id === "outdoor");
        f.lines.visible = show;
        const chosen = p.floor === f.label;
        f.lines.opacity = p.floor === null ? 0.58 : chosen ? 0.95 : 0.26;
        f.fill.visible = show && chosen;
      }
    }

    // Checkpoints: the outdoor ones from above; a building's own once it is chosen, those of the open floor lit.
    const list: { checkpoint: Checkpoint; position: V3 }[] = [];
    for (const c of data.checkpoints) {
      if (!selected) {
        if (c.building === "outdoor") list.push({ checkpoint: c, position: at(c.x, c.y, c.z + 0.4) });
        continue;
      }
      if (c.building !== selected.data.id && c.joins !== selected.data.id) continue;
      const index = selected.floors.findIndex((f) => f.label === c.floor);
      if (index < 0) continue;
      const z = (selected.data.id === "outdoor" && !exploded ? c.z : index * selected.gap) + 0.4;
      if (p.floor !== null && c.floor !== p.floor) continue;
      list.push({ checkpoint: c, position: at(c.x, c.y, z) });
    }
    shown = list;
    const positions = new Float32Array(Math.max(1, list.length) * 3);
    list.forEach((item, i) => positions.set(item.position, i * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    dotCount = list.length;
    // Before a floor is open the dots are only a hint of where checkpoints are.
    dotSize = p.building && p.floor === null ? DOT - 3 : DOT;
    dotOpacity = p.building && p.floor === null ? 0.5 : 1;

    const chosen = list.find((item) => item.checkpoint.id === p.selectedId);
    if (chosen) {
      gl.bindBuffer(gl.ARRAY_BUFFER, coreBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(chosen.position));
      selectedPosition = chosen.position;
      selectedName = chosen.checkpoint.name;
    } else {
      selectedPosition = null;
      selectedName = "";
    }
    chosenOn = chosen !== undefined;
    startPulse();

    // Only a change of building or floor moves the camera; a tap on a dot does not.
    const key = `${p.building ?? ""}|${p.floor ?? ""}|${p.insetBottom ?? 0}|${width}x${height}`;
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
        ringSize = 34 + wave * 12;
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
    tweening = false;
  };

  const onMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous || !gesture) return;
    const next = local(event);
    pointers.set(event.pointerId, next);
    if (pointers.size >= 2) {
      const d = pinchDistance();
      if (gesture.pinch > 0) view.dist = Math.min(baseDist * 1.4, Math.max(baseDist * 0.08, (view.dist * gesture.pinch) / d));
      gesture.pinch = d;
      gesture.moved = true;
      request();
      return;
    }
    if (!gesture.moved && Math.hypot(next.x - gesture.startX, next.y - gesture.startY) < TAP_SLOP) return;
    gesture.moved = true;
    view.yaw -= (next.x - previous.x) * 0.0065;
    view.pitch = Math.min((80 * Math.PI) / 180, Math.max((24 * Math.PI) / 180, view.pitch + (next.y - previous.y) * 0.0045));
    request();
  };

  /** The point where the ray through a pixel meets the horizontal plane at height h, and its distance. */
  const ground = (x: number, y: number, h: number): { point: V3; d: number } | null => {
    const nx = (x / width) * 2 - 1;
    const ny = -(y / height) * 2 + 1 - shift();
    const dir = unit([
      cam.fwd[0] + cam.right[0] * nx * TAN_HALF * (width / height) + cam.up[0] * ny * TAN_HALF,
      cam.fwd[1] + cam.right[1] * nx * TAN_HALF * (width / height) + cam.up[1] * ny * TAN_HALF,
      cam.fwd[2] + cam.right[2] * nx * TAN_HALF * (width / height) + cam.up[2] * ny * TAN_HALF,
    ]);
    if (Math.abs(dir[1]) < 1e-6) return null;
    const t = (h - cam.pos[1]) / dir[1];
    if (t <= 0) return null;
    return { point: [cam.pos[0] + dir[0] * t, h, cam.pos[2] + dir[2] * t], d: t };
  };

  const tap = (x: number, y: number) => {
    const p = getProps();
    // A checkpoint dot first: the nearest one within reach of the finger.
    let best: { id: string; d: number } | null = null;
    for (const item of shown) {
      const q = project(item.position);
      if (!q.ok) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d <= PICK_RADIUS && (!best || d < best.d)) best = { id: item.checkpoint.id, d };
    }
    if (best) {
      p.onSelect(best.id);
      return;
    }
    // Then a building: where the ray meets the building at its middle height.
    let hit: { id: BuildingId; d: number } | null = null;
    for (const g of groups.values()) {
      if (g.data.id === "outdoor" || g.hit.length < 3) continue;
      for (const h of [g.data.roofZ * 0.5, g.data.roofZ, 0]) {
        const r = ground(x, y, h);
        if (r && insidePolygon([r.point[0], -r.point[2]], g.hit) && (!hit || r.d < hit.d)) hit = { id: g.data.id, d: r.d };
      }
    }
    // Inside a pulled-apart building: the plate under the finger, nearest the camera.
    const open = p.building ? groups.get(p.building) : undefined;
    if (open && open.data.id !== "outdoor") {
      let plate: { label: string; d: number } | null = null;
      for (const f of open.floors) {
        const r = ground(x, y, f.index * open.gap);
        if (!r) continue;
        const loops = open.data.floors[f.index].outlines.length > 0 ? open.data.floors[f.index].outlines : open.data.footprint;
        if (!loops.some((loop) => insidePolygon([r.point[0], -r.point[2]], loop))) continue;
        if (!plate || r.d < plate.d) plate = { label: f.label, d: r.d };
      }
      if (plate && !hit) {
        p.onFloor(plate.label);
        return;
      }
    }
    if (hit && hit.id !== p.building) p.onBuilding(hit.id);
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
    view.dist = Math.min(baseDist * 1.4, Math.max(baseDist * 0.08, view.dist * Math.exp(event.deltaY * 0.0012)));
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
    },
  };
}
