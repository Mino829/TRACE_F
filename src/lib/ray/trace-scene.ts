/**
 * 振り返り3D (#50): the participant's way through the campus after the
 * experience, as one still line of light among the buildings' floor
 * outlines, from the place of the first photo to ShibaLab. Nothing moves on
 * its own; a drag turns the view and a pinch or Ctrl and the wheel bring it
 * closer.
 *
 * The buildings are the place picker's (選択3D) outlines, the way is the
 * exhibit's (展示3D) graph and shortest paths, and both share one frame:
 * metres, x east, y up, z south. This module is loaded only when the view
 * opens, since the graph comes with it.
 *
 * Where each photo was taken is the participant's own pick, kept on the
 * phone. Until TRACE_B returns the way it builds from those picks
 * (Mino829/TRACE_B#25), the way here is stitched the same way from them.
 */

import { CAMPUS_GRAPH_VERSION, NODES, routeThrough, toScene, type Vec3 } from "@/lib/display/campus-graph";
import { buildRoutePath } from "@/lib/display/route-path";
import { compileProgram, getContext, LINE_FRAGMENT, LINE_VERTEX } from "@/lib/places/webgl";
import type { PlacesData, PlacePoint } from "@/lib/places/types";

/** Where the way ends: ShibaLab, 教室棟301. */
export const SHIBALAB = "shibalab";

export type TraceStop = { checkpointId: string };

export type TraceWay = {
  /** The polyline, in scene metres. */
  points: Vec3[];
  /** Each stop's point, in the order given; null for one the graph does not know. */
  stops: (Vec3 | null)[];
  end: Vec3;
  /** "教室棟|3F" for each floor the way passes along. */
  floors: Set<string>;
};

/**
 * The way through the photos' places, in the order taken, on to ShibaLab. A
 * place picked on another version of the graph, or one the graph does not
 * know, is left out of the way.
 */
export function traceWay(stops: (TraceStop & { graphVersion: string })[]): TraceWay {
  const known = stops.map((stop) => (stop.graphVersion === CAMPUS_GRAPH_VERSION && NODES.has(stop.checkpointId) ? stop.checkpointId : null));
  const ids = [...known.filter((id): id is string => id !== null), SHIBALAB];
  const route = routeThrough(ids);
  const path = buildRoutePath(route);
  const floors = new Set<string>();
  for (const id of route) {
    const node = NODES.get(id);
    if (node?.building && !node.floor.startsWith("屋外")) floors.add(`${node.building}|${node.floor}`);
  }
  return {
    points: path.points,
    stops: known.map((id) => (id ? toScene(NODES.get(id)!.threeD) : null)),
    end: toScene(NODES.get(SHIBALAB)!.threeD),
    floors,
  };
}

// ---------------------------------------------------------------------------
// The camera: an orbit round a point, looking down at the campus.

const FOV = (34 * Math.PI) / 180;
const NEAR = 1;
const FAR = 4000;
/** South-east, a little above: the way the place picker first shows the campus. */
const YAW = 0.42;
const PITCH = 0.66;
const PITCH_MIN = 0.22;
const PITCH_MAX = 1.42;

type View = { target: Vec3; dist: number; yaw: number; pitch: number };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

function eye(view: View): Vec3 {
  const { target, dist, yaw, pitch } = view;
  return [target[0] + dist * Math.cos(pitch) * Math.sin(yaw), target[1] + dist * Math.sin(pitch), target[2] + dist * Math.cos(pitch) * Math.cos(yaw)];
}

/** Projection times view, column-major. */
function viewMatrix(view: View, aspect: number): Float32Array {
  const pos = eye(view);
  const fwd = unit(sub(view.target, pos));
  const right = unit(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const f = 1 / Math.tan(FOV / 2);
  const range = 1 / (NEAR - FAR);
  // P * V written out: V's rows are right, up, -fwd, each with its translation.
  const rows = [right, up, [-fwd[0], -fwd[1], -fwd[2]] as Vec3];
  const t = rows.map((row) => -dot(row, pos));
  const p = [f / aspect, f, (NEAR + FAR) * range, 2 * NEAR * FAR * range];
  const m = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    const col = (r: number) => (c < 3 ? rows[r][c] : t[r]);
    m[c * 4 + 0] = p[0] * col(0);
    m[c * 4 + 1] = p[1] * col(1);
    m[c * 4 + 2] = p[2] * col(2) + (c === 3 ? p[3] : 0);
    m[c * 4 + 3] = -col(2);
  }
  return m;
}

function transform(m: Float32Array, p: Vec3): [number, number, number, number] {
  return [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]) as [number, number, number, number];
}

/** A view of all the points, from the given direction, with some room round them. */
function fitView(points: Vec3[], aspect: number, yaw = YAW, pitch = PITCH): View {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], p[i]);
    max[i] = Math.max(max[i], p[i]);
  }
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(18, ...points.map((p) => Math.hypot(...sub(p, target))));
  const half = Math.min(FOV / 2, Math.atan(Math.tan(FOV / 2) * aspect));
  return { target, dist: (radius / Math.sin(half)) * 1.08, yaw, pitch };
}

// ---------------------------------------------------------------------------
// Drawing: faint floor outlines, the way as a thick line, round marks.

/** The way: each segment a quad widened on the screen, so it keeps its width at any distance. */
const WAY_VERTEX = `
attribute vec3 a_pos;
attribute vec3 a_other;
attribute float a_side;
uniform mat4 u_mvp;
uniform vec2 u_px;
uniform float u_width;
void main() {
  vec4 a = u_mvp * vec4(a_pos, 1.0);
  vec4 b = u_mvp * vec4(a_other, 1.0);
  vec2 d = (b.xy / b.w - a.xy / a.w) / u_px;
  float l = length(d);
  vec2 dir = l > 0.0001 ? d / l : vec2(1.0, 0.0);
  a.xy += vec2(-dir.y, dir.x) * a_side * u_width * 0.5 * u_px * a.w;
  gl_Position = a;
}
`;

/** Round marks: u_kind 0 is a filled disc, 1 a ring. */
const MARK_VERTEX = `
attribute vec3 a_pos;
uniform mat4 u_mvp;
// Shared with the fragment shader, so it has to say the same precision.
uniform mediump float u_size;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); gl_PointSize = u_size; }
`;

const MARK_FRAGMENT = `
precision mediump float;
uniform vec4 u_color;
uniform float u_kind;
uniform float u_size;
void main() {
  float d = length(gl_PointCoord - 0.5) * u_size;
  float r = u_size * 0.5;
  float a = u_kind < 0.5 ? 1.0 - smoothstep(r - 1.2, r, d) : 1.0 - smoothstep(1.0, 2.0, abs(d - (r - 2.5)));
  a *= u_color.a;
  gl_FragColor = vec4(u_color.rgb * a, a);
}
`;

type Rgb = [number, number, number];

function colorOf(css: string, fallback: Rgb): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(css);
  if (rgb) {
    const [r, g, b] = rgb[1].split(",").map((v) => parseFloat(v) / 255);
    return [r, g, b];
  }
  return fallback;
}

function loopLines(loops: PlacePoint[][], z: number, out: number[]) {
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const [x0, y0] = loop[i];
      const [x1, y1] = loop[(i + 1) % loop.length];
      out.push(x0, z, -y0, x1, z, -y1);
    }
  }
}

/**
 * How strongly each part is drawn, sizes in device px: on the screen, and in
 * the keepsake, whose picture is larger and goes through a JPEG.
 */
type Look = { quiet: number; roofs: number; walked: number; glow: number; line: number; joint: number; stop: number; ring: number; core: number };
const SCREEN: Look = { quiet: 0.13, roofs: 0.2, walked: 0.42, glow: 11, line: 3, joint: 3, stop: 9, ring: 22, core: 7 };
const STILL: Look = { quiet: 0.2, roofs: 0.3, walked: 0.55, glow: 30, line: 8, joint: 7, stop: 22, ring: 54, core: 16 };

/** Where a scene point lands on a picture `width` × `height`; null behind the camera. */
function screenOf(matrix: Float32Array, p: Vec3, width: number, height: number): { x: number; y: number } | null {
  const [x, y, , w] = transform(matrix, p);
  if (w <= NEAR) return null;
  return { x: ((x / w + 1) / 2) * width, y: ((1 - y / w) / 2) * height };
}

/** The buildings, the way and its marks, ready to be drawn through any view; `scale` multiplies the look's sizes. */
function painter(gl: WebGLRenderingContext, data: PlacesData, way: TraceWay, fg: Rgb, look: Look) {
  const lineProgram = compileProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
  const markProgram = compileProgram(gl, MARK_VERTEX, MARK_FRAGMENT);
  const wayProgram = compileProgram(gl, WAY_VERTEX, LINE_FRAGMENT);
  const uniforms = (program: WebGLProgram, names: string[]) => Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(program, name)]));
  const lineU = uniforms(lineProgram, ["u_mvp", "u_off", "u_color"]);
  const markU = uniforms(markProgram, ["u_mvp", "u_size", "u_color", "u_kind"]);
  const wayU = uniforms(wayProgram, ["u_mvp", "u_px", "u_width", "u_color"]);
  const otherAt = gl.getAttribLocation(wayProgram, "a_other");
  const sideAt = gl.getAttribLocation(wayProgram, "a_side");

  const buffers: WebGLBuffer[] = [];
  const buffer = (values: number[]) => {
    const made = gl.createBuffer();
    if (!made) throw new Error("WebGL のバッファを作れませんでした。");
    gl.bindBuffer(gl.ARRAY_BUFFER, made);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    buffers.push(made);
    return made;
  };

  // The buildings: every floor's outline, faint; the floors the way runs along a little brighter; each roof.
  const quiet: number[] = [];
  const walked: number[] = [];
  const roofs: number[] = [];
  for (const building of data.buildings) {
    if (building.id === "outdoor") continue;
    const floors = [...building.floors].sort((a, b) => a.z - b.z);
    for (const floor of floors) {
      const loops = floor.outlines.length ? floor.outlines : building.footprint;
      loopLines(loops, floor.z, way.floors.has(`${building.name}|${floor.label}`) ? walked : quiet);
    }
    const top = floors.at(-1);
    loopLines(top?.outlines.length ? top.outlines : building.footprint, building.roofZ, roofs);
    // Upright edges at the footprint's corners, from the ground to the roof.
    for (const loop of building.footprint) for (const [x, y] of loop) roofs.push(x, 0, -y, x, building.roofZ, -y);
  }
  const lineLayers = [
    { buffer: buffer(quiet), count: quiet.length / 3, opacity: look.quiet },
    { buffer: buffer(roofs), count: roofs.length / 3, opacity: look.roofs },
    { buffer: buffer(walked), count: walked.length / 3, opacity: look.walked },
  ];

  // The way: two triangles a segment, each corner knowing the other end and its side.
  const wayVertices: number[] = [];
  for (let i = 1; i < way.points.length; i++) {
    const p = way.points[i - 1];
    const q = way.points[i];
    const corner = (at: Vec3, other: Vec3, side: number) => wayVertices.push(...at, ...other, side);
    corner(p, q, 1);
    corner(p, q, -1);
    corner(q, p, -1);
    corner(q, p, -1);
    corner(p, q, -1);
    corner(q, p, 1);
  }
  const wayBuffer = buffer(wayVertices);
  const wayCount = wayVertices.length / 7;
  const joints = buffer(way.points.flat());
  const stops = way.stops.filter((p): p is Vec3 => p !== null);
  const stopBuffer = buffer(stops.flat());
  const endBuffer = buffer(way.end);

  return {
    /** Draws into the viewport as it is set, `scale` device px to the look's px. */
    draw(matrix: Float32Array, scale: number) {
      const canvas = gl.canvas as HTMLCanvasElement;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(lineU.u_mvp, false, matrix);
      gl.uniform3f(lineU.u_off, 0, 0, 0);
      gl.enableVertexAttribArray(0);
      for (const layer of lineLayers) {
        if (!layer.count) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.buffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.uniform4f(lineU.u_color, fg[0], fg[1], fg[2], layer.opacity);
        gl.drawArrays(gl.LINES, 0, layer.count);
      }

      // The way: a wide soft band of light under a sharp line.
      if (wayCount) {
        gl.useProgram(wayProgram);
        gl.uniformMatrix4fv(wayU.u_mvp, false, matrix);
        gl.uniform2f(wayU.u_px, 2 / canvas.width, 2 / canvas.height);
        gl.bindBuffer(gl.ARRAY_BUFFER, wayBuffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(otherAt);
        gl.vertexAttribPointer(otherAt, 3, gl.FLOAT, false, 28, 12);
        gl.enableVertexAttribArray(sideAt);
        gl.vertexAttribPointer(sideAt, 1, gl.FLOAT, false, 28, 24);
        for (const [px, opacity] of [[look.glow, 0.1], [look.line, 1]] as const) {
          gl.uniform1f(wayU.u_width, px * scale);
          gl.uniform4f(wayU.u_color, fg[0], fg[1], fg[2], opacity);
          gl.drawArrays(gl.TRIANGLES, 0, wayCount);
        }
        gl.disableVertexAttribArray(otherAt);
        gl.disableVertexAttribArray(sideAt);
      }

      // Round joints where the way turns, a dot at each photo's place, and a ring at ShibaLab.
      gl.useProgram(markProgram);
      gl.uniformMatrix4fv(markU.u_mvp, false, matrix);
      const marks = (target: WebGLBuffer, count: number, size: number, kind: number, opacity: number) => {
        if (!count) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, target);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.uniform1f(markU.u_size, size * scale);
        gl.uniform1f(markU.u_kind, kind);
        gl.uniform4f(markU.u_color, fg[0], fg[1], fg[2], opacity);
        gl.drawArrays(gl.POINTS, 0, count);
      };
      marks(joints, way.points.length, look.joint, 0, 1);
      marks(stopBuffer, stops.length, look.stop, 0, 1);
      marks(endBuffer, 1, look.ring, 1, 1);
      marks(endBuffer, 1, look.core, 0, 1);
    },
    dispose() {
      buffers.forEach((made) => gl.deleteBuffer(made));
      [lineProgram, markProgram, wayProgram].forEach((program) => gl.deleteProgram(program));
    },
  };
}

export type TraceScene = {
  /** Where a scene point is on the host, in CSS px; null behind the camera. */
  project: (p: Vec3) => { x: number; y: number } | null;
  /** Back to the first view. */
  reset: () => void;
  dispose: () => void;
};

/**
 * Draws the way on a canvas inside `host`, which takes the gestures. Throws
 * when there is no WebGL; `onLost` is called if the context goes later.
 * `onFrame` runs after each frame, to move anything laid over the canvas.
 */
export function createTraceScene(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  data: PlacesData,
  way: TraceWay,
  { onFrame, onLost }: { onFrame: () => void; onLost: () => void },
): TraceScene {
  const gl = getContext(canvas);
  if (!gl) throw new Error("WebGL を使えません。");
  const style = getComputedStyle(host);
  const fg = colorOf(style.getPropertyValue("--fg"), [0.83, 0.84, 0.83]);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const paint = painter(gl, data, way, fg, SCREEN);

  const everything = [...way.points, way.end, ...way.stops.filter((p): p is Vec3 => p !== null)];
  let width = 1;
  let height = 1;
  let first = fitView(everything, 1);
  let view: View = { ...first };
  let matrix = viewMatrix(view, 1);
  let frame = 0;
  let disposed = false;

  const draw = () => {
    frame = 0;
    if (disposed || gl.isContextLost()) return;
    matrix = viewMatrix(view, width / height);
    gl.viewport(0, 0, canvas.width, canvas.height);
    paint.draw(matrix, dpr);
    onFrame();
  };
  const request = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(draw);
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const fresh = width === 1 && height === 1;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    first = fitView(everything, width / height);
    if (fresh) view = { ...first };
    request();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // A drag turns the view round the way; two fingers or Ctrl and the wheel bring it closer.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const zoom = (factor: number) => {
    view.dist = Math.min(first.dist * 2.4, Math.max(first.dist * 0.18, view.dist * factor));
    request();
  };
  const down = (event: PointerEvent) => {
    // A press on anything laid over the canvas (a photo) stays a tap on it.
    if (event.target === canvas) host.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinch = spread();
  };
  const move = (event: PointerEvent) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    const now = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, now);
    if (pointers.size >= 2) {
      const next = spread();
      if (pinch && next) zoom(pinch / next);
      pinch = next;
      return;
    }
    view.yaw -= (now.x - last.x) * 0.0065;
    view.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, view.pitch + (now.y - last.y) * 0.0045));
    request();
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    pinch = spread();
  };
  // The view sits in a page that scrolls: the wheel zooms only with Ctrl, which a trackpad's pinch also sends.
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoom(Math.exp(event.deltaY * 0.0012));
  };
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
  host.addEventListener("wheel", wheel, { passive: false });
  const lost = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lost);

  return {
    project(p) {
      return screenOf(matrix, p, width, height);
    },
    reset() {
      view = { ...first };
      request();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      host.removeEventListener("wheel", wheel);
      canvas.removeEventListener("webglcontextlost", lost);
      paint.dispose();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/**
 * The screen's first view, brought round and in until the points fill the
 * picture but for `pad` (a fraction of its width and height) at each side:
 * a band much wider than tall would otherwise leave the way small in its
 * middle. Never closer than half the first distance, so a short way keeps
 * the buildings round it.
 */
function stillView(points: Vec3[], aspect: number, pad: { x: number; y: number }): View {
  const first = fitView(points, aspect);
  const view: View = { ...first, target: [...first.target] };
  // Each pass centres the points and scales the distance by how much they over- or under-fill; a few settle it.
  for (let pass = 0; pass < 4; pass++) {
    const matrix = viewMatrix(view, aspect);
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of points) {
      const [x, y, , w] = transform(matrix, p);
      if (w <= NEAR) continue;
      [x0, x1, y0, y1] = [Math.min(x0, x / w), Math.max(x1, x / w), Math.min(y0, y / w), Math.max(y1, y / w)];
    }
    if (x0 > x1) break;
    const fwd = unit(sub(view.target, eye(view)));
    const right = unit(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const halfY = view.dist * Math.tan(FOV / 2);
    const [cx, cy] = [((x0 + x1) / 2) * halfY * aspect, ((y0 + y1) / 2) * halfY];
    view.target = [0, 1, 2].map((i) => view.target[i] + right[i] * cx + up[i] * cy) as Vec3;
    const fill = Math.max((x1 - x0) / 2 / (1 - 2 * pad.x), (y1 - y0) / 2 / (1 - 2 * pad.y), 0.01);
    view.dist = Math.max(first.dist * 0.5, view.dist * fill);
  }
  return view;
}

/**
 * 振り返り3D as a still picture of `width` × `height` px, from the direction
 * the screen opens on, for the keepsake: the lines in `color` on nothing,
 * the way filling the picture but for `pad` px across and down at each side.
 * `project` says where a scene point is on it. Throws when there is no WebGL.
 */
export function traceStill(
  data: PlacesData,
  way: TraceWay,
  width: number,
  height: number,
  color: Rgb,
  pad: { x: number; y: number },
): { image: HTMLCanvasElement; project: (p: Vec3) => { x: number; y: number } | null } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const gl = getContext(canvas);
  if (!gl) throw new Error("WebGL を使えません。");
  const paint = painter(gl, data, way, color, STILL);
  const view = stillView([...way.points, way.end, ...way.stops.filter((p): p is Vec3 => p !== null)], width / height, { x: pad.x / width, y: pad.y / height });
  const matrix = viewMatrix(view, width / height);
  gl.viewport(0, 0, width, height);
  paint.draw(matrix, 1);
  // Copied out at once: WebGL keeps its picture only until this task is over.
  const image = document.createElement("canvas");
  image.width = width;
  image.height = height;
  image.getContext("2d")?.drawImage(canvas, 0, 0);
  paint.dispose();
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return { image, project: (p) => screenOf(matrix, p, width, height) };
}
