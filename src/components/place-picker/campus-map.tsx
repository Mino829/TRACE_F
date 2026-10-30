"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Building, BuildingId, Checkpoint, Landmark, PlacePoint, PlacesData } from "@/lib/places/types";
import { LINE_FRAGMENT, LINE_VERTEX, POINT_FRAGMENT, POINT_VERTEX, compileProgram, getContext } from "@/lib/places/webgl";

import "./campus-map.css";

/**
 * The map a participant picks a photo's place on, in three stages:
 *
 *   1. the whole campus. Each building is drawn in lines over floors of thin
 *      paper, so it can be seen through, and named on a framed tag with a "›"
 *      that opens it. The outdoor checkpoints are dots on the ground, named
 *      only while touched and once chosen: a place outside is picked by where
 *      it is, and a building (go in) never looks like one (pick this);
 *   2. a building: it comes close, the others sink to their outlines on the
 *      ground, and a rail of its floors runs down the right edge. A finger
 *      sliding along the rail shades the floor under it; letting go opens it.
 *      Nothing is opened or chosen by itself;
 *   3. a floor: the floors above fade to faint lines. A tap on a checkpoint
 *      picks it; a tap anywhere else does nothing.
 *
 * The camera is placed by the stage, so every choice is in view. Two fingers
 * zoom (and move) the map; a mouse wheel zooms. One finger picks: a touch that
 * moves less than TAP_SLOP is a tap, held however long, and what it would pick
 * is shaded while it is down. A drag past it turns the map round and tilts it,
 * whichever way the finger goes, and the map stays as it is let go, zoom and
 * all. Names follow their places while the map moves; when it stops, a name
 * that still has room stays where it is and one that has not glides to a new
 * place. Once a second finger lands, nothing is picked or turned until every
 * finger is off. Crumbs at the top left go back a stage.
 *
 * No 3D library: small shaders (src/lib/places/webgl.ts), flat colour, and the
 * stencil for floors with holes. A frame is drawn only while something moves,
 * or while the chosen place's ring pulses (twenty frames a second, never with
 * reduced motion or a hidden tab).
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
  className?: string;
};

const FOV = 34;
const TAN_HALF = Math.tan((FOV * Math.PI) / 360);
const NEAR = 2;
const FAR = 4000;
/** A touch that moves less than this (px) is a tap, however long it is held. */
const TAP_SLOP = 14;
const QUARTER = Math.PI / 2;
/** A drag this long (px) turns the map a quarter round, or tilts it as far. */
const TURN_PX = 200;
/** How far a drag may tilt the map: from low over the ground to nearly straight down. */
const PITCH_MIN = (15 * Math.PI) / 180;
const PITCH_MAX = (85 * Math.PI) / 180;
/** How long a name takes to glide to a new place once the map stops (ms). */
const LABEL_MS = 220;
/** A checkpoint takes a tap within this many px of its dot: a 44px target round a dot drawn smaller. */
const PICK_RADIUS = 22;
/** A name takes a tap this far outside its box too (px sideways, px up and down), so a small name is a 44px target. */
const LABEL_PAD: [number, number] = [4, 8];
/** How far the map zooms in and out, as a share of the distance the stage was framed from. */
const ZOOM_IN = 0.3;
const ZOOM_OUT = 1.6;
const TWEEN_MS = 350;
const PULSE_INTERVAL = 50;
/** Room kept round the whole campus, and round a building, as a share of the frame. */
const MARGIN_CAMPUS = 0.06;
const MARGIN_BUILDING = 0.08;
/** Inside a building the floor rail takes the right edge and the crumbs the top left (px). */
const RAIL_ROOM = 72;
const CRUMB_ROOM = 56;

const PITCH_CAMPUS = (44 * Math.PI) / 180;
/** The whole campus is seen from about here (south-east), give or take a little to fill the frame. */
const CAMPUS_YAW = 0.42;
const PITCH_BUILDING = (30 * Math.PI) / 180;
/** A floor is seen from higher up than a building, so its parts and names read as a plan. */
const PITCH_FLOOR = (52 * Math.PI) / 180;

type V3 = [number, number, number];
type View = { x: number; y: number; z: number; dist: number; yaw: number; pitch: number };
type Cam = { pos: V3; right: V3; up: V3; fwd: V3 };
type Mesh = { buffer: WebGLBuffer; count: number };
type Box = { x0: number; x1: number; y0: number; y1: number };

/** One storey of a building: from its floor up to the next one, in lines over a floor of thin paper. */
type Storey = {
  label: string;
  index: number;
  z: number;
  top: number;
  loops: PlacePoint[][];
  /** The outline at the floor's height, and an upright at each corner up to the next floor. */
  ring: Mesh;
  posts: Mesh;
  /**
   * The outline at its top where the storey above does not stand on it: a roof terrace's edge, a bridge's
   * ceiling, the corner of a lower wing.
   */
  rim: Mesh;
  /** The outline as fans at height 0, for the stencil (even-odd, so a hole stays a hole), and a rectangle over it. */
  fan: Mesh;
  cover: Mesh;
};

type BuildingPart = {
  data: Building;
  storeys: Storey[];
  /** Its outline on the ground: all that is drawn of it while another building is open. */
  base: Mesh;
  box: Box;
  tag: HTMLButtonElement;
  /** Its name as a sign while another building is open, at the edge of the frame when the building is out of it. */
  cue: HTMLSpanElement;
};

/** An escalator drawn inside its building: a slanted band (two handrails, the lanes' divide and a few steps). */
type EscalatorPart = { mesh: Mesh; building: BuildingId; foot: number; head: number };

/** What a finger is on: a building to open, a floor of the open one, or a checkpoint. */
type Target = { kind: "building"; id: BuildingId } | { kind: "floor"; label: string } | { kind: "spot"; id: string };

type Engine = {
  apply: () => void;
  /** Shades a floor of the open building (the rail under a finger), or none. */
  preview: (label: string | null) => void;
  dispose: () => void;
};

export function CampusMap(props: CampusMapProps) {
  const { data, building, floor, selectedId, onBuilding, onFloor, className } = props;
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const propsRef = useRef(props);
  /** The floor a finger on the drawing of the open building is on, shown on the rail as if held there. */
  const [pointed, setPointed] = useState<string | null>(null);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let engine: Engine;
    try {
      engine = createEngine(stage, data, () => propsRef.current, setPointed);
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
  }, [building, floor, selectedId]);

  const open = building ? data.buildings.find((item) => item.id === building) : undefined;
  // Highest at the top, as on a lift's panel.
  const floors = useMemo(() => (open ? [...open.floors].sort((a, b) => b.z - a.z).map((item) => item.label) : []), [open]);
  const chosen = selectedId ? data.checkpoints.find((point) => point.id === selectedId) : undefined;
  const marked = open && chosen && (chosen.building === open.id || chosen.joins === open.id) ? chosen.floor : null;

  return (
    <div className={`cm${className ? ` ${className}` : ""}`}>
      <div ref={stageRef} className="cm__stage" role="group" aria-label="キャンパスの地図" />
      {open && (
        <nav className="cm__crumbs" aria-label="地図の段階">
          <button type="button" className="cm__crumb" onClick={() => onBuilding(null)}>
            キャンパス
          </button>
          <span className="cm__sep" aria-hidden="true">
            ›
          </span>
          {floor ? (
            <button type="button" className="cm__crumb" onClick={() => onBuilding(open.id)}>
              {open.name}
            </button>
          ) : (
            <span className="cm__here" aria-current="location">
              {open.name}
            </span>
          )}
          {floor && (
            <>
              <span className="cm__sep" aria-hidden="true">
                ›
              </span>
              <span className="cm__here mono" aria-current="location">
                {floor}
              </span>
            </>
          )}
        </nav>
      )}
      {open && (
        <FloorRail
          key={open.id}
          building={open.name}
          floors={floors}
          current={floor}
          marked={marked}
          pointed={pointed}
          onPreview={(label) => engineRef.current?.preview(label)}
          onPick={onFloor}
        />
      )}
    </div>
  );
}

/**
 * The open building's floors down the right edge, all of them without scrolling. A finger put anywhere on the
 * rail and slid along it holds the floor under it (shaded on the map, its number shown large beside the finger);
 * letting go opens that floor. A finger on the drawing of the building shows its floor here the same way. The floor
 * of the chosen place carries a dot. Each floor is also a button, for the keyboard.
 */
function FloorRail({
  building,
  floors,
  current,
  marked,
  pointed,
  onPreview,
  onPick,
}: {
  building: string;
  floors: string[];
  current: string | null;
  marked: string | null;
  pointed: string | null;
  onPreview: (label: string | null) => void;
  onPick: (label: string) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const heldRef = useRef<string | null>(null);
  const [railHeld, setHeld] = useState<string | null>(null);
  const held = railHeld ?? pointed;

  const floorAt = (clientY: number): string => {
    const box = listRef.current?.getBoundingClientRect();
    if (!box || box.height <= 0) return floors[0];
    const index = Math.floor(((clientY - box.top) / box.height) * floors.length);
    return floors[Math.min(floors.length - 1, Math.max(0, index))];
  };

  const hold = (label: string | null) => {
    if (label === heldRef.current) return;
    heldRef.current = label;
    setHeld(label);
    // A short tick at each floor passed, where the phone has a motor.
    if (label) navigator.vibrate?.(6);
    onPreview(label);
  };

  return (
    <div
      className="cm__rail"
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        hold(floorAt(event.clientY));
      }}
      onPointerMove={(event) => {
        if (heldRef.current !== null) hold(floorAt(event.clientY));
      }}
      onPointerUp={() => {
        const label = heldRef.current;
        hold(null);
        if (label) onPick(label);
      }}
      onPointerCancel={() => hold(null)}
    >
      <ol ref={listRef} className="cm__floors" aria-label={`${building}の階`} style={{ ["--floors" as string]: floors.length }}>
        {floors.map((label) => (
          <li key={label}>
            <button
              type="button"
              className="cm__floor"
              aria-label={`${building} ${label}`}
              aria-pressed={label === current}
              data-held={label === held || undefined}
              data-marked={label === marked || undefined}
              // A finger is handled by the rail as a whole; a click here comes from the keyboard.
              onClick={(event) => {
                if (event.detail === 0) onPick(label);
              }}
            >
              {label}
            </button>
          </li>
        ))}
        {held && (
          <li className="cm__held" aria-hidden="true" style={{ top: `${((floors.indexOf(held) + 0.5) / floors.length) * 100}%` }}>
            {held}
          </li>
        )}
      </ol>
    </div>
  );
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
/** The signed angle from b to a, between -π and π. */
const turnBetween = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

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

/** The edges of an outline at height z that are not also edges of the outline above (drawn there already). */
function rimSegments(loops: PlacePoint[][], above: PlacePoint[][], z: number): number[] {
  const key = (a: PlacePoint, b: PlacePoint) => [a, b].map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).sort().join("|");
  const shared = new Set<string>();
  for (const loop of above) for (let i = 0; i < loop.length; i++) shared.add(key(loop[i], loop[(i + 1) % loop.length]));
  const out: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      if (!shared.has(key(a, b))) out.push(a[0], z, -a[1], b[0], z, -b[1]);
    }
  }
  return out;
}

/** Each loop as a fan from its first point, at height 0. Drawn into the stencil with INVERT, the fans leave set exactly the points inside the outline (even-odd). */
function fans(loops: PlacePoint[][]): number[] {
  const out: number[] = [];
  for (const loop of loops) {
    for (let i = 1; i + 1 < loop.length; i++) {
      const a = loop[0];
      const b = loop[i];
      const c = loop[i + 1];
      out.push(a[0], 0, -a[1], b[0], 0, -b[1], c[0], 0, -c[1]);
    }
  }
  return out;
}

/** A rectangle over a box (a metre to spare), at height 0. */
function cover(box: Box): number[] {
  const x0 = box.x0 - 1;
  const x1 = box.x1 + 1;
  const y0 = box.y0 - 1;
  const y1 = box.y1 + 1;
  return [x0, 0, -y0, x1, 0, -y0, x1, 0, -y1, x0, 0, -y0, x1, 0, -y1, x0, 0, -y1];
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

/**
 * A checkpoint's name on an open floor, without what the crumbs already say: "教室棟3F 研究棟側" is "研究棟側",
 * "ShibaLab（教室棟3F 301）" is "ShibaLab（301）". Another building's checkpoint keeps its building's name
 * ("本部棟 渡り廊下の口"). A name that would be left empty, or only the building's, stays whole.
 */
function floorName(data: PlacesData, point: Checkpoint, open: BuildingId): string {
  const own = data.buildings.find((b) => b.id === point.building)?.name ?? "";
  let name = point.name.replace(`${own}${point.floor}`, point.building === open ? "" : `${own} `);
  if (name.endsWith(` ${point.floor}`)) name = name.slice(0, -point.floor.length - 1);
  name = name.replace(/（\s+/g, "（").replace(/\s{2,}/g, " ").trim();
  return name.length > 0 && name !== own ? name : point.name;
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

/** A colour of the screen the map sits in (a CSS variable), as 0..1 RGB. */
function readColor(host: HTMLElement, variable: string, fallback: string, rgb: V3): V3 {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${variable},${fallback})`;
  host.appendChild(probe);
  const numbers = getComputedStyle(probe).color.match(/[\d.]+/g);
  host.removeChild(probe);
  return numbers && numbers.length >= 3 ? [Number(numbers[0]) / 255, Number(numbers[1]) / 255, Number(numbers[2]) / 255] : rgb;
}

/**
 * A name laid over the map. It takes no pointer (the map finds what a finger is on, names included, so a drag
 * that starts on a name still turns the map), but it is still a button for the keyboard.
 */
function button(parent: HTMLElement, className: string, text: string, onTap: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = text;
  el.addEventListener("click", (event) => {
    event.stopPropagation();
    onTap();
  });
  parent.appendChild(el);
  return el;
}

function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function sameTarget(a: Target | null, b: Target | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "floor") return b.kind === "floor" && a.label === b.label;
  return (b.kind === "building" || b.kind === "spot") && a.kind === b.kind && a.id === b.id;
}

// ---------------------------------------------------------------------------

function createEngine(host: HTMLDivElement, data: PlacesData, getProps: () => CampusMapProps, onPoint: (floor: string | null) => void): Engine {
  const ink = readColor(host, "--fg", "#0c0c0d", [0.047, 0.047, 0.05]);
  /** The thin paper each floor is laid with: it tones down the light and the lines behind, without hiding them. */
  const paper = readColor(host, "--bg", "#d3d5d3", [0.827, 0.835, 0.827]);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  const canvas = document.createElement("canvas");
  canvas.className = "cm__canvas";
  canvas.style.touchAction = "none";
  const gl = getContext(canvas, true);
  if (!gl || !gl.getContextAttributes()?.stencil) throw new Error("WebGL を使えません。");
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
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  gl.enableVertexAttribArray(0);

  host.appendChild(canvas);
  const overlay = document.createElement("div");
  overlay.className = "cm__labels";
  host.appendChild(overlay);

  const buffers: WebGLBuffer[] = [];
  const makeMesh = (vertices: number[]): Mesh => {
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("バッファを作れませんでした。");
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices.length > 0 ? vertices : [0, 0, 0]), gl.STATIC_DRAW);
    return { buffer, count: vertices.length / 3 };
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
  const ground = makeMesh(groundVertices);

  const parts = new Map<BuildingId, BuildingPart>();
  for (const b of built) {
    const sorted = [...b.floors].sort((p, q) => p.z - q.z);
    const storeys: Storey[] = sorted.map((f, index) => {
      const loops = f.outlines.length > 0 ? f.outlines : b.footprint;
      const top = index + 1 < sorted.length ? sorted[index + 1].z : Math.max(b.roofZ, f.z + 3);
      const ring: number[] = [];
      loopSegments(loops, f.z, ring);
      const posts: number[] = [];
      for (const loop of loops) for (const [x, y] of loop) posts.push(x, f.z, -y, x, top, -y);
      // The top storey's rim is its roof.
      const next = sorted[index + 1];
      const above = next ? (next.outlines.length > 0 ? next.outlines : b.footprint) : [];
      return {
        label: f.label,
        index,
        z: f.z,
        top,
        loops,
        ring: makeMesh(ring),
        posts: makeMesh(posts),
        rim: makeMesh(rimSegments(loops, above, top)),
        fan: makeMesh(fans(loops)),
        cover: makeMesh(cover(bounds(loops))),
      };
    });
    const base: number[] = [];
    loopSegments(b.footprint.length > 0 ? b.footprint : (storeys[0]?.loops ?? []), 0, base);
    const tag = button(overlay, "cm__building", "", () => getProps().onBuilding(b.id));
    const name = document.createElement("span");
    name.textContent = b.name;
    const chevron = document.createElement("span");
    chevron.className = "cm__chevron";
    chevron.textContent = "›";
    chevron.setAttribute("aria-hidden", "true");
    tag.append(name, chevron);
    tag.setAttribute("aria-label", `${b.name}を開く`);
    const cue = document.createElement("span");
    cue.className = "cm__cue";
    cue.setAttribute("aria-hidden", "true");
    overlay.appendChild(cue);
    const loops = storeys.flatMap((s) => s.loops);
    parts.set(b.id, { data: b, storeys, base: makeMesh(base), box: bounds(loops.length > 0 ? loops : b.footprint), tag, cue });
  }

  // Landmarks that tell a building from inside: the classroom building's escalators.
  const escalators: EscalatorPart[] = (data.landmarks ?? [])
    .filter((e) => e.kind === "escalator" && parts.has(e.building))
    .map((e) => ({ mesh: makeMesh(escalatorLines(e)), building: e.building, foot: Math.min(e.from[2], e.to[2]), head: Math.max(e.from[2], e.to[2]) }));

  // Checkpoint names: beside their dots on an open floor, and beside the outdoor ones on the whole campus.
  const tags = new Map<string, HTMLButtonElement>();
  for (const c of data.checkpoints) tags.set(c.id, button(overlay, "cm__spot", c.name, () => getProps().onSelect(c.id)));

  // Dots: the checkpoints in view, and a ring that pulses on the chosen one.
  const dotMesh = makeMesh(new Array<number>(Math.max(1, data.checkpoints.length) * 3).fill(0));
  const coreMesh = makeMesh([0, 0, 0]);
  let dotCount = 0;
  let dotSize = 13;
  let ringSize = 44;
  let ringOpacity = 0.9;
  let coreOpacity = 1;
  let shown: { checkpoint: Checkpoint; position: V3 }[] = [];
  let chosenOn = false;

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
  /** The next change of frame jumps instead of gliding (the first one, and any after the frame's size changed). */
  let snapNext = true;
  /** How the current stage was framed, before any zoom: the zoom is kept between ZOOM_IN and ZOOM_OUT of it. */
  let framed: View = { ...view };
  /** The participant has zoomed or moved the map since the stage was framed; the frame then stays as they left it. */
  let moved = false;
  /** The whole campus' direction, chosen once for the frame's width; every stage is seen from it, give or take the quarter turns. */
  let campusYaw: number | null = null;
  /** How far the participant has turned the map from the campus' direction. It carries from stage to stage, so the view never swings round by itself. */
  let spin = 0;
  /** How far they have tilted it from the stage's own height. A new stage is seen from its own height again. */
  let tilt = 0;
  /** A finger is turning the map: names follow their places without being laid out again. */
  let turning = false;
  /** What a finger (or the mouse) is on, shaded until it lifts. */
  let pressed: Target | null = null;
  /** The floor under a finger on the rail. */
  let previewLabel: string | null = null;

  const openPart = (): BuildingPart | undefined => {
    const id = getProps().building;
    return id ? parts.get(id) : undefined;
  };
  const openStorey = (part: BuildingPart | undefined): Storey | undefined => {
    const label = getProps().floor;
    return part && label ? part.storeys.find((s) => s.label === label) : undefined;
  };

  const screenOf = (c: Cam, p: V3): { x: number; y: number; ok: boolean } => {
    const rel = sub(p, c.pos);
    const depth = dot(rel, c.fwd);
    if (depth <= NEAR) return { x: 0, y: 0, ok: false };
    const nx = dot(rel, c.right) / (depth * TAN_HALF * (width / height));
    const ny = dot(rel, c.up) / (depth * TAN_HALF);
    return { x: ((nx + 1) / 2) * width, y: ((1 - ny) / 2) * height, ok: true };
  };
  const project = (p: V3) => screenOf(cam, p);

  // Where to put the camera so a set of points fills the frame with room to spare, whatever the frame's shape:
  // the points are projected from a trial camera, which is moved back and re-centred until they just fit.
  type Room = { left: number; right: number; top: number; bottom: number };
  const fit = (points: V3[], yaw: number, pitch: number, share: number, extra: Partial<Room> = {}): View => {
    const room: Room = {
      left: width * share + (extra.left ?? 0),
      right: width * share + (extra.right ?? 0),
      top: height * share + (extra.top ?? 0),
      bottom: height * share + (extra.bottom ?? 0),
    };
    const availX = Math.max(40, width - room.left - room.right);
    const availY = Math.max(40, height - room.top - room.bottom);
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
    for (let i = 0; i < 16; i++) {
      const c = camOf({ x: target[0], y: target[1], z: target[2], dist, yaw, pitch });
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const q of points) {
        const v = screenOf(c, q);
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

  // The outlines themselves are framed, not their boxes, so a building set at an angle is not framed with room to spare.
  const outlineAt = (loops: PlacePoint[][], heights: number[]): V3[] => heights.flatMap((z) => loops.flatMap((loop) => loop.map(([x, y]) => at(x, y, z))));
  const campusPoints: V3[] = [
    ...built.flatMap((b) => outlineAt(b.footprint.length > 0 ? b.footprint : b.floors.flatMap((f) => f.outlines), [0, b.roofZ])),
    ...outdoor.map((c) => at(c.x, c.y, c.z)),
  ];

  /** The direction every stage is seen from: the one (around the south-east) where the whole campus shows largest, plus the participant's turn. */
  const yawNow = (): number => {
    if (campusYaw === null) {
      // A portrait frame turns a long campus to stand up in it.
      let best: View | null = null;
      for (let i = -3; i <= 3; i++) {
        const v = fit(campusPoints, CAMPUS_YAW + (i / 3) * (Math.PI / 5), PITCH_CAMPUS, MARGIN_CAMPUS, { top: 20 });
        if (!best || v.dist < best.dist) best = v;
      }
      campusYaw = best?.yaw ?? CAMPUS_YAW;
    }
    return campusYaw + spin;
  };

  /** The height the stage is seen from, before the participant's tilt: a floor from higher up than a building. */
  const stagePitch = (): number => {
    const part = openPart();
    return !part ? PITCH_CAMPUS : openStorey(part) ? PITCH_FLOOR : PITCH_BUILDING;
  };
  const pitchNow = (): number => Math.min(PITCH_MAX, Math.max(PITCH_MIN, stagePitch() + tilt));

  const frameOf = (): View => {
    const part = openPart();
    if (!part) return fit(campusPoints, yawNow(), pitchNow(), MARGIN_CAMPUS, { top: 20 });
    const room = { right: RAIL_ROOM, top: CRUMB_ROOM - 12 };
    const storey = openStorey(part);
    if (!storey) return fit(part.storeys.flatMap((s) => outlineAt(s.loops, [s.z, s.top])), yawNow(), pitchNow(), MARGIN_BUILDING, room);
    // The floor alone, as large as it goes, with its checkpoints (a bridge's may stand outside it). The storeys
    // below run off the frame.
    return fit([...outlineAt(storey.loops, [storey.z, storey.z + 2]), ...shown.map((s) => s.position)], yawNow(), pitchNow(), MARGIN_BUILDING, room);
  };

  const matrix = (): Float32Array => {
    const { pos, right, up, fwd } = cam;
    const view4 = [right[0], up[0], -fwd[0], 0, right[1], up[1], -fwd[1], 0, right[2], up[2], -fwd[2], 0, -dot(right, pos), -dot(up, pos), dot(fwd, pos), 1];
    const f = 1 / TAN_HALF;
    const proj = [f / (width / height), 0, 0, 0, 0, f, 0, 0, 0, 0, (FAR + NEAR) / (NEAR - FAR), -1, 0, 0, (2 * FAR * NEAR) / (NEAR - FAR), 0];
    return multiply(proj, view4);
  };

  // ---- Drawing

  const ZERO: V3 = [0, 0, 0];
  const draw = (mesh: Mesh, mode: number, color: V3, alpha: number, offset: V3 = ZERO) => {
    if (mesh.count === 0 || alpha <= 0.005) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.uniform3f(lineUniform.off, offset[0], offset[1], offset[2]);
    gl.uniform4f(lineUniform.color, color[0], color[1], color[2], alpha);
    gl.drawArrays(mode, 0, mesh.count);
  };

  /** A storey's floor at height z, filled flat inside its outline: the stencil (even-odd) keeps a light well open. */
  const floorFill = (s: Storey, z: number, color: V3, alpha: number) => {
    if (alpha <= 0.005) return;
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    draw(s.fan, gl.TRIANGLES, ink, 1, [0, z, 0]);
    // The rectangle over it lands only inside, and clears the stencil behind it.
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
    draw(s.cover, gl.TRIANGLES, color, alpha, [0, z, 0]);
    gl.disable(gl.STENCIL_TEST);
  };

  /** The open building's storey to shade: the one under a finger on the rail, or pressed on the map. */
  const litStorey = (part: BuildingPart | undefined): Storey | undefined => {
    const label = previewLabel ?? (pressed?.kind === "floor" ? pressed.label : null);
    return part && label ? part.storeys.find((s) => s.label === label) : undefined;
  };

  /** How strongly a storey is drawn: its floor's paper (or ink, when shaded), its outline, uprights and rim. */
  type Look = { fill: number; tint: boolean; ring: number; posts: number; rim: number };
  const lookOf = (s: Storey, shaded: boolean, open: Storey | undefined): Look => {
    if (shaded) return { fill: 0.16, tint: true, ring: 1, posts: 0.8, rim: 1 };
    if (!open) return { fill: 0.3, tint: false, ring: 0.75, posts: 0.55, rim: 0.8 };
    if (s.index < open.index) return { fill: 0.3, tint: false, ring: 0.5, posts: 0.38, rim: 0.5 };
    // Above the open floor: faint lines only, so they do not cover it.
    return { fill: 0, tint: false, ring: 0.14, posts: 0.1, rim: 0.14 };
  };

  /** Escalators: all of them on the whole campus; inside a building only its own, those that reach an open floor strongest. */
  const escalatorAlpha = (e: EscalatorPart, part: BuildingPart | undefined, storey: Storey | undefined): number => {
    if (!part) return 0.6;
    if (e.building !== part.data.id) return 0;
    if (!storey) return 0.85;
    if (Math.abs(e.foot - storey.z) < 0.8 || Math.abs(e.head - storey.z) < 0.8) return 1;
    return e.head <= storey.z ? 0.4 : 0.12;
  };

  const renderFrame = () => {
    if (disposed || gl.isContextLost()) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const m = matrix();
    const part = openPart();
    const storey = openStorey(part);
    const lit = litStorey(part);
    const pressedBuilding = pressed?.kind === "building" ? pressed.id : null;

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(lineUniform.mvp, false, m);

    // Every building on the whole campus; inside one, only it (the others are outlines on the ground). An open
    // floor is drawn last, over the rest.
    const drawn: { s: Storey; look: Look }[] = [];
    for (const q of parts.values()) {
      if (part && q !== part) continue;
      for (const s of q.storeys) if (s !== storey) drawn.push({ s, look: lookOf(s, q.data.id === pressedBuilding || s === lit, storey) });
    }
    for (const { s, look } of drawn) floorFill(s, s.z, look.tint ? ink : paper, look.fill);
    draw(ground, gl.LINES, ink, part ? 0.12 : 0.16);
    for (const q of parts.values()) if (part && q !== part) draw(q.base, gl.LINES, ink, 0.3);
    for (const { s, look } of drawn) {
      draw(s.ring, gl.LINES, ink, look.ring);
      draw(s.posts, gl.LINES, ink, look.posts);
      draw(s.rim, gl.LINES, ink, look.rim);
    }
    for (const e of escalators) draw(e.mesh, gl.LINES, ink, escalatorAlpha(e, part, storey));
    if (storey) {
      // Paper enough to tone down the floors below, a little ink to set it apart, then its outline in full.
      floorFill(storey, storey.z, paper, 0.55);
      floorFill(storey, storey.z, ink, 0.12);
      draw(storey.ring, gl.LINES, ink, 1);
      draw(storey.posts, gl.LINES, ink, 0.3);
      draw(storey.rim, gl.LINES, ink, 0.3);
    }

    // Dots: the checkpoints in view, where a finger would put a position, and the chosen place.
    gl.useProgram(pointProgram);
    gl.uniformMatrix4fv(pointUniform.mvp, false, m);
    const points = (mesh: Mesh, count: number, size: number, opacity: number, kind: number) => {
      if (count === 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.uniform1f(pointUniform.size, size * dpr);
      gl.uniform4f(pointUniform.color, ink[0], ink[1], ink[2], opacity);
      gl.uniform1f(pointUniform.kind, kind);
      gl.drawArrays(gl.POINTS, 0, count);
    };
    points(dotMesh, dotCount, dotSize, 1, 0);
    if (chosenOn) {
      points(coreMesh, 1, ringSize, ringOpacity, 1);
      points(coreMesh, 1, dotSize + 6, coreOpacity, 0);
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
      view.yaw = from.yaw + turnBetween(goal.yaw, from.yaw) * e;
      if (t >= 1) tweening = false;
    }
    cam = camOf(view);
    // While the view moves, names keep their places beside their buildings and dots; once it stops they are laid out again.
    updateLabels(!tweening && !turning && !pinch);
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

  // ---- Names: measured once, kept inside the frame and nudged apart so none hides another.

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
  const setText = (el: HTMLElement, text: string) => {
    if (el.textContent === text) return;
    el.textContent = text;
    sizes.delete(el);
  };

  /**
   * A name to place: its size, the point it belongs to, the places it may go (tried in order), what it opens or
   * picks, and whether it may be left off when there is no room for it.
   */
  type Slot = { el: HTMLElement; w: number; h: number; anchor: [number, number]; options: [number, number][]; target: Target | null; optional: boolean };
  type Rect = { cx: number; cy: number; w: number; h: number };
  /** Where each name went beside its point the last time they were laid out; kept while the view moves. */
  const offsets = new WeakMap<HTMLElement, [number, number]>();
  /** The names on show and what each one takes a tap for: the map's own list, since names take no pointer. */
  let hits: { rect: Rect; target: Target }[] = [];
  /** Names left off for want of room, and kept off while the view moves (a checkpoint's dot still takes its tap). */
  const left = new WeakSet<HTMLElement>();

  const clashes = (a: Rect, b: Rect) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 + 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2 + 1;

  /**
   * Puts each name at the first of its places that is inside the frame and clear of the names already placed and
   * of every dot (a name never covers a checkpoint); when none is clear, a name that may be left off is (zoomed in,
   * there is room for it again), and any other goes to the least crowded. The place a name had comes first, so a
   * name with room stays where it is when the map stops, and one that must move glides there. With `solve` off
   * (the view is moving) each name keeps the place it had beside its point.
   */
  const settle = (slots: Slot[], area: Box, dots: Rect[], solve: boolean) => {
    const placed: Rect[] = [...dots];
    const inside = (x: number, y: number, slot: Slot): Rect => ({
      cx: Math.min(area.x1 - slot.w / 2, Math.max(area.x0 + slot.w / 2, x)),
      cy: Math.min(area.y1 - slot.h / 2, Math.max(area.y0 + slot.h / 2, y)),
      w: slot.w,
      h: slot.h,
    });
    hits = [];
    for (const slot of slots) {
      let best: Rect | null = null;
      const kept = offsets.get(slot.el);
      if (!solve && left.has(slot.el)) continue;
      if (!solve && kept) {
        best = inside(slot.anchor[0] + kept[0], slot.anchor[1] + kept[1], slot);
        // Following its point, a name moves with the map at once.
        if (slot.el.style.transition) slot.el.style.transition = "";
      } else {
        let fewest = Infinity;
        const options: [number, number][] = kept && !left.has(slot.el) ? [[slot.anchor[0] + kept[0], slot.anchor[1] + kept[1]], ...slot.options] : slot.options;
        for (const [x, y] of options) {
          const r = inside(x, y, slot);
          const crowd = placed.filter((o) => clashes(o, r)).length + (r.cx !== x || r.cy !== y ? 0.5 : 0);
          if (crowd < fewest) {
            fewest = crowd;
            best = r;
          }
          if (crowd === 0) break;
        }
        if (slot.optional && fewest >= 1) {
          left.add(slot.el);
          continue;
        }
        const shownBefore = kept !== undefined && !left.has(slot.el);
        left.delete(slot.el);
        if (best) {
          const next: [number, number] = [best.cx - slot.anchor[0], best.cy - slot.anchor[1]];
          if (shownBefore && !reduced && Math.hypot(next[0] - kept[0], next[1] - kept[1]) > 1) slot.el.style.transition = `transform ${LABEL_MS}ms ease-out`;
          offsets.set(slot.el, next);
        }
      }
      if (!best) continue;
      placed.push(best);
      slot.el.dataset.on = "true";
      slot.el.style.transform = `translate3d(${(best.cx - best.w / 2).toFixed(1)}px,${(best.cy - best.h / 2).toFixed(1)}px,0)`;
      if (slot.target) hits.push({ rect: best, target: slot.target });
    }
  };

  /** Places round a point for a name of this size: right, left, above, below, then the corners. */
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

  /** Arrows by direction on the screen, from the right going clockwise. */
  const ARROWS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

  const updateLabels = (solve: boolean) => {
    const p = getProps();
    const part = openPart();
    // Inside the frame, clear of the crumbs (top left) and the floor rail (right).
    const area: Box = { x0: 4, x1: width - (part ? RAIL_ROOM : 4), y0: part ? CRUMB_ROOM : 4, y1: height - 4 };
    const buildingSlots: Slot[] = [];
    const cueSlots: Slot[] = [];
    for (const q of parts.values()) {
      q.tag.dataset.on = "false";
      q.cue.dataset.on = "false";
      if (!part) {
        // On the whole campus, each building's tag above its roof; it may move round it but stays by its building.
        const r = project(at(q.data.labelAt[0], q.data.labelAt[1], q.data.roofZ + 3));
        if (!r.ok) continue;
        const size = sizeOf(q.tag);
        buildingSlots.push({ el: q.tag, ...size, anchor: [r.x, r.y], options: [[r.x, r.y - size.h / 2 - 2], ...around8(r.x, r.y, size.w, size.h, 6)], target: { kind: "building", id: q.data.id }, optional: false });
      } else if (q !== part) {
        // Inside a building, the others are named where they stand, or at the edge with an arrow towards them.
        const r = project(at(q.data.labelAt[0], q.data.labelAt[1], 0));
        if (!r.ok) continue;
        const inFrame = r.x > area.x0 && r.x < area.x1 && r.y > area.y0 && r.y < area.y1;
        let text = q.data.name;
        if (!inFrame) {
          const cx = (area.x0 + area.x1) / 2;
          const cy = (area.y0 + area.y1) / 2;
          const octant = Math.round(Math.atan2(r.y - cy, r.x - cx) / (Math.PI / 4));
          const arrow = ARROWS[(octant + 8) % 8];
          text = r.x < cx - 1 ? `${arrow} ${q.data.name}` : `${q.data.name} ${arrow}`;
        }
        setText(q.cue, text);
        const size = sizeOf(q.cue);
        cueSlots.push({ el: q.cue, ...size, anchor: [r.x, r.y], options: [[r.x, r.y], ...around8(r.x, r.y, size.w, size.h, 8)], target: null, optional: true });
      }
    }
    const dots: Rect[] = [];
    for (const tag of tags.values()) tag.dataset.on = "false";
    const spotSlots: Slot[] = [];
    for (const item of shown) {
      const r = project(item.position);
      if (!r.ok) continue;
      dots.push({ cx: r.x, cy: r.y, w: 18, h: 18 });
      const tag = tags.get(item.checkpoint.id);
      if (!tag) continue;
      // On the whole campus a place outside is picked by where it is: its name shows only while touched, and once chosen.
      const named = item.checkpoint.id === p.selectedId || (pressed?.kind === "spot" && pressed.id === item.checkpoint.id);
      if (!part && !named) continue;
      const size = sizeOf(tag);
      // Close beside the dot first; a little farther out when all the near places are taken.
      const slot: Slot = {
        el: tag,
        ...size,
        anchor: [r.x, r.y],
        options: [...around8(r.x, r.y, size.w, size.h, 14), ...around8(r.x, r.y, size.w, size.h, 34)],
        target: { kind: "spot", id: item.checkpoint.id },
        optional: !named,
      };
      // The chosen (or touched) one's name goes first, so it gets the best place.
      if (named) spotSlots.unshift(slot);
      else spotSlots.push(slot);
    }
    // On the whole campus the buildings' names matter most; on a floor its places'. Signs go last.
    settle(part ? [...spotSlots, ...cueSlots] : [...buildingSlots, ...spotSlots], area, dots, solve);
  };

  // ---- What a finger is on

  /** Where the ray through a pixel meets the horizontal plane at height h, and how far along the ray. */
  const rayAt = (x: number, y: number, h: number): { point: PlacePoint; d: number } | null => {
    const nx = (x / width) * 2 - 1;
    const ny = -(y / height) * 2 + 1;
    const sx = nx * TAN_HALF * (width / height);
    const sy = ny * TAN_HALF;
    const dir = unit([cam.fwd[0] + cam.right[0] * sx + cam.up[0] * sy, cam.fwd[1] + cam.right[1] * sx + cam.up[1] * sy, cam.fwd[2] + cam.right[2] * sx + cam.up[2] * sy]);
    if (Math.abs(dir[1]) < 1e-6) return null;
    const t = (h - cam.pos[1]) / dir[1];
    if (t <= 0) return null;
    return { point: [cam.pos[0] + dir[0] * t, -(cam.pos[2] + dir[2] * t)], d: t };
  };

  /** The building (and storey) a pixel falls in: the first floor plate, roof or storey's middle the ray passes through. */
  const buildingAt = (x: number, y: number, only?: BuildingPart): { part: BuildingPart; storey: Storey; d: number } | null => {
    let best: { part: BuildingPart; storey: Storey; d: number } | null = null;
    for (const part of only ? [only] : parts.values()) {
      const highest = part.storeys[part.storeys.length - 1];
      const levels: { z: number; storey: Storey }[] = part.storeys.map((s) => ({ z: s.z, storey: s }));
      if (highest) levels.push({ z: part.data.roofZ, storey: highest });
      // The walls between levels count too: test halfway up each storey.
      for (const s of part.storeys) levels.push({ z: (s.z + s.top) / 2, storey: s });
      for (const level of levels) {
        const r = rayAt(x, y, level.z);
        if (!r || !insideLoops(r.point, level.storey.loops)) continue;
        if (!best || r.d < best.d) best = { part, storey: level.storey, d: r.d };
      }
    }
    return best;
  };

  /**
   * What a touch at (x, y) would open or pick. A name first (its own box), then a dot within reach, then a name
   * within its margin; then, on the whole campus, a building; inside a building, one of its storeys. Anything else
   * is nothing: a tap on the open floor away from its checkpoints, or off it, picks nothing and never leaves it.
   */
  const hitTest = (x: number, y: number): Target | null => {
    const inBox = (r: Rect, px: number, py: number) => Math.abs(x - r.cx) <= r.w / 2 + px && Math.abs(y - r.cy) <= r.h / 2 + py;
    const exact = hits.find((h) => inBox(h.rect, 0, 0));
    if (exact) return exact.target;
    let near: { id: string; d: number } | null = null;
    for (const item of shown) {
      const q = project(item.position);
      if (!q.ok) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d <= PICK_RADIUS && (!near || d < near.d)) near = { id: item.checkpoint.id, d };
    }
    if (near) return { kind: "spot", id: near.id };
    let margin: { target: Target; d: number } | null = null;
    for (const h of hits) {
      if (!inBox(h.rect, LABEL_PAD[0], LABEL_PAD[1])) continue;
      const d = Math.hypot(h.rect.cx - x, h.rect.cy - y);
      if (!margin || d < margin.d) margin = { target: h.target, d };
    }
    if (margin) return margin.target;
    const part = openPart();
    if (!part) {
      const hit = buildingAt(x, y);
      return hit ? { kind: "building", id: hit.part.data.id } : null;
    }
    if (openStorey(part)) return null;
    const hit = buildingAt(x, y, part);
    return hit ? { kind: "floor", label: hit.storey.label } : null;
  };

  const elementOf = (target: Target | null): HTMLElement | undefined =>
    target?.kind === "building" ? parts.get(target.id)?.tag : target?.kind === "spot" ? tags.get(target.id) : undefined;

  const setPressed = (target: Target | null) => {
    if (sameTarget(target, pressed)) return;
    elementOf(pressed)?.removeAttribute("data-pressed");
    pressed = target;
    elementOf(pressed)?.setAttribute("data-pressed", "true");
    // A storey of the open building has no name on the map: the rail says which floor it is.
    onPoint(pressed?.kind === "floor" ? pressed.label : null);
    request();
  };

  const commit = (target: Target | null) => {
    if (!target) return;
    const p = getProps();
    if (target.kind === "spot") p.onSelect(target.id);
    else if (target.kind === "building") p.onBuilding(target.id);
    else p.onFloor(target.label);
  };

  // ---- The stage, from the props

  let lastFrameKey = "";

  const apply = () => {
    const p = getProps();
    const part = openPart();
    const storey = openStorey(part);

    // Checkpoints: the outdoor ones on the whole campus; on an open floor, its own (a bridge's in both buildings).
    const list: { checkpoint: Checkpoint; position: V3 }[] = [];
    if (!part) {
      for (const c of outdoor) list.push({ checkpoint: c, position: at(c.x, c.y, c.z + 0.4) });
    } else if (storey) {
      for (const c of data.checkpoints) {
        if (c.floor !== storey.label || (c.building !== part.data.id && c.joins !== part.data.id)) continue;
        list.push({ checkpoint: c, position: at(c.x, c.y, storey.z + 0.5) });
      }
    }
    shown = list;
    const positions = new Float32Array(Math.max(1, list.length) * 3);
    list.forEach((item, i) => positions.set(item.position, i * 3));
    gl.bindBuffer(gl.ARRAY_BUFFER, dotMesh.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    dotCount = list.length;
    dotSize = part ? 16 : 13;

    // Their names: on the whole campus whole (one at a time); on a floor without what the crumbs say.
    for (const item of list) {
      const tag = tags.get(item.checkpoint.id);
      if (!tag) continue;
      tag.setAttribute("aria-pressed", String(item.checkpoint.id === p.selectedId));
      tag.dataset.floor = String(part !== undefined);
      setText(tag, part ? floorName(data, item.checkpoint, part.data.id) : item.checkpoint.name);
    }

    // The chosen checkpoint, where it is in view.
    const chosenAt = list.find((item) => item.checkpoint.id === p.selectedId)?.position ?? null;
    chosenOn = chosenAt !== null;
    if (chosenAt) {
      gl.bindBuffer(gl.ARRAY_BUFFER, coreMesh.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(chosenAt));
    }
    startPulse();

    // Only a change of stage frames the map again; a tap on a place, a turn or a zoom does not.
    const key = `${p.building ?? ""}|${p.floor ?? ""}`;
    if (key !== lastFrameKey) {
      // A new stage is seen from its own height (a frame made again for a new size keeps the tilt).
      if (lastFrameKey !== "") tilt = 0;
      lastFrameKey = key;
      moved = false;
      const next = frameOf();
      framed = { ...next };
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

  let lastWidth = 0;
  const resize = () => {
    const rect = host.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    // The campus' direction is chosen again only for a new width (a phone turned), not when the browser's bars come
    // and go, so the view does not swing round on its own; nor is a zoom of the participant's undone by them.
    if (width !== lastWidth) {
      lastWidth = width;
      campusYaw = null;
      moved = false;
    }
    if (!moved) {
      lastFrameKey = "";
      snapNext = true;
    }
    apply();
  };

  // ---- Touches: one finger picks, or turns and tilts the map once it drags; two fingers zoom and move it.

  /** Where each finger on the map is. */
  const fingers = new Map<number, { x: number; y: number }>();
  type Press = { id: number; x0: number; y0: number; target: Target | null; mode: "press" | "turn"; yaw0: number; pitch0: number };
  let press: Press | null = null;
  /** Set when a second finger lands: nothing is picked or turned until every finger is off. */
  let spoiled = false;

  const local = (event: PointerEvent | WheelEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  /** Keeps the middle of the view over the campus, so a zoomed map cannot be moved off it. */
  const keepOver = () => {
    view.x = Math.min(groundBox.x1, Math.max(groundBox.x0, view.x));
    view.z = Math.min(-groundBox.y0, Math.max(-groundBox.y1, view.z));
    cam = camOf(view);
  };

  /** Moves the map so the point under (x0, y0) comes under (x1, y1). */
  const moveBy = (x0: number, y0: number, x1: number, y1: number) => {
    const a = rayAt(x0, y0, view.y);
    const b = rayAt(x1, y1, view.y);
    if (a && b) {
      view.x += a.point[0] - b.point[0];
      view.z -= a.point[1] - b.point[1];
    }
    keepOver();
  };

  /** Zooms by `factor` (above 1 comes closer) round the point under (x, y), within ZOOM_IN and ZOOM_OUT of the stage's frame. */
  const zoomAt = (x: number, y: number, factor: number) => {
    const before = rayAt(x, y, view.y);
    view.dist = Math.min(framed.dist * ZOOM_OUT, Math.max(framed.dist * ZOOM_IN, view.dist / factor));
    cam = camOf(view);
    const after = rayAt(x, y, view.y);
    if (before && after) {
      view.x += before.point[0] - after.point[0];
      view.z -= before.point[1] - after.point[1];
    }
    keepOver();
  };

  /** Two fingers on the map: how far apart they were and where their middle was, the last time they moved. */
  let pinch: { d: number; x: number; y: number } | null = null;
  const pinchNow = (): { d: number; x: number; y: number } | null => {
    const [a, b] = [...fingers.values()];
    return a && b ? { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  };

  /** Lets go of a turn: the map stays as it is, and its turn and tilt carry on to the frames to come. */
  const endTurn = () => {
    turning = false;
    spin = turnBetween(view.yaw, yawNow() - spin);
    tilt = view.pitch - stagePitch();
    // The names are laid out again where the map stopped.
    request();
  };

  const endPress = () => {
    if (press?.mode === "turn") endTurn();
    press = null;
    setPressed(null);
  };

  /** A finger has lifted: two still down carry on zooming from where they are, fewer stop. */
  const releaseFinger = (id: number) => {
    fingers.delete(id);
    if (pinch) {
      pinch = pinchNow();
      if (!pinch) request();
    }
  };

  const onDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    const p0 = local(event);
    fingers.set(event.pointerId, p0);
    if (fingers.size > 1) {
      spoiled = true;
      endPress();
      tweening = false;
      pinch = pinchNow();
      return;
    }
    const target = hitTest(p0.x, p0.y);
    press = { id: event.pointerId, x0: p0.x, y0: p0.y, target, mode: "press", yaw0: view.yaw, pitch0: view.pitch };
    setPressed(target);
  };

  const onMove = (event: PointerEvent) => {
    const now = local(event);
    if (fingers.has(event.pointerId)) fingers.set(event.pointerId, now);
    if (pinch) {
      const next = pinchNow();
      if (!next) return;
      moveBy(pinch.x, pinch.y, next.x, next.y);
      if (pinch.d > 0 && next.d > 0) zoomAt(next.x, next.y, next.d / pinch.d);
      pinch = next;
      moved = true;
      request();
      return;
    }
    if (!press) {
      // A mouse with no button down: shade what it is over.
      if (event.pointerType === "mouse" && fingers.size === 0) {
        const target = hitTest(now.x, now.y);
        setPressed(target);
        canvas.style.cursor = target ? "pointer" : "";
      }
      return;
    }
    if (event.pointerId !== press.id || spoiled) return;
    if (press.mode === "press") {
      if (Math.hypot(now.x - press.x0, now.y - press.y0) < TAP_SLOP) return;
      // Past the slop the finger turns the map, whichever way it goes, from where it is now (so the map does not
      // jump) and taking the camera from a glide.
      setPressed(null);
      press.mode = "turn";
      press.x0 = now.x;
      press.y0 = now.y;
      press.yaw0 = view.yaw;
      press.pitch0 = view.pitch;
      tweening = false;
      turning = true;
    }
    // A finger moving right turns the yaw down; one moving down looks from higher up.
    view.yaw = press.yaw0 - ((now.x - press.x0) / TURN_PX) * QUARTER;
    view.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, press.pitch0 + ((now.y - press.y0) / TURN_PX) * QUARTER));
    request();
  };

  const onUp = (event: PointerEvent) => {
    releaseFinger(event.pointerId);
    if (press && event.pointerId === press.id && !spoiled) {
      const done = press;
      press = null;
      setPressed(null);
      if (done.mode === "press") commit(done.target);
      else endTurn();
    }
    if (fingers.size === 0) spoiled = false;
  };

  // A touch the system took over (a call, a gesture) picks nothing.
  const onCancel = (event: PointerEvent) => {
    releaseFinger(event.pointerId);
    if (press && event.pointerId === press.id) endPress();
    if (fingers.size === 0) spoiled = false;
  };

  const onLeave = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && !press) {
      setPressed(null);
      canvas.style.cursor = "";
    }
  };

  // A mouse wheel (or a trackpad's pinch) zooms round the pointer.
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const p0 = local(event);
    tweening = false;
    zoomAt(p0.x, p0.y, Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)));
    moved = true;
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
  canvas.addEventListener("pointerleave", onLeave);
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
    preview(label) {
      if (label === previewLabel) return;
      previewLabel = label;
      request();
    },
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
      canvas.removeEventListener("pointerleave", onLeave);
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
