/**
 * The campus as wire only, for the title: 振り返り3D's buildings (every
 * floor's outline, each roof, the corners' uprights) without the way or any
 * mark, turning slowly round its middle. A sideways drag turns it by hand;
 * with reduced motion it turns only then.
 *
 * The camera is trace-scene.ts's, written again here: that module comes with
 * the campus graph, which the title has no use for.
 */

import { PLACES } from "@/lib/places/places";
import type { PlacePoint } from "@/lib/places/types";
import { compileProgram, getContext, LINE_FRAGMENT, LINE_VERTEX } from "@/lib/places/webgl";

type Vec3 = [number, number, number];

const FOV = (34 * Math.PI) / 180;
const NEAR = 1;
const FAR = 4000;
const PITCH = 0.5;
/** The way trace-scene.ts first looks: from the south-east. */
const YAW = 0.42;
/** A turn every two minutes, in radians a second. */
const SPIN = (2 * Math.PI) / 120;
/** Below this height (CSS px) the room is too small to show anything. */
const MIN_HEIGHT = 72;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

/** Projection times view, column-major, for an eye `dist` from `target` at `yaw` round and `PITCH` up. */
function viewMatrix(target: Vec3, dist: number, yaw: number, aspect: number): Float32Array {
  const pos: Vec3 = [target[0] + dist * Math.cos(PITCH) * Math.sin(yaw), target[1] + dist * Math.sin(PITCH), target[2] + dist * Math.cos(PITCH) * Math.cos(yaw)];
  const fwd = unit(sub(target, pos));
  const right = unit(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const f = 1 / Math.tan(FOV / 2);
  const range = 1 / (NEAR - FAR);
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

function colorOf(css: string): Vec3 {
  const rgb = /rgba?\(([^)]+)\)/.exec(css);
  if (!rgb) return [0.83, 0.84, 0.83];
  const [r, g, b] = rgb[1].split(",").map((v) => parseFloat(v) / 255);
  return [r, g, b];
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
 * Draws on a canvas inside `host`, in the host's text colour, which also
 * takes the drag. Throws when there is no WebGL; `onLost` is called if the
 * context goes later.
 */
export function createCampusWire(host: HTMLElement, canvas: HTMLCanvasElement, { onLost }: { onLost: () => void }): { dispose: () => void } {
  const gl = getContext(canvas);
  if (!gl) throw new Error("WebGL を使えません。");
  const color = colorOf(getComputedStyle(host).color);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const program = compileProgram(gl, LINE_VERTEX, LINE_FRAGMENT);
  const mvpAt = gl.getUniformLocation(program, "u_mvp");
  const offAt = gl.getUniformLocation(program, "u_off");
  const colorAt = gl.getUniformLocation(program, "u_color");

  const floors: number[] = [];
  const edges: number[] = [];
  for (const building of PLACES.buildings) {
    if (building.id === "outdoor") continue;
    const sorted = [...building.floors].sort((a, b) => a.z - b.z);
    for (const floor of sorted) loopLines(floor.outlines.length ? floor.outlines : building.footprint, floor.z, floors);
    const top = sorted.at(-1);
    loopLines(top?.outlines.length ? top.outlines : building.footprint, building.roofZ, edges);
    for (const loop of building.footprint) for (const [x, y] of loop) edges.push(x, 0, -y, x, building.roofZ, -y);
  }
  const buffers: WebGLBuffer[] = [];
  const layer = (values: number[], opacity: number) => {
    const made = gl.createBuffer();
    if (!made) throw new Error("WebGL のバッファを作れませんでした。");
    gl.bindBuffer(gl.ARRAY_BUFFER, made);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    buffers.push(made);
    return { buffer: made, count: values.length / 3, opacity };
  };
  const layers = [layer(floors, 0.2), layer(edges, 0.34)];

  // Turned round the middle of the buildings; how far off depends on the room's shape.
  const all = [...floors, ...edges];
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < all.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], all[i + k]);
    max[k] = Math.max(max[k], all[i + k]);
  }
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let reach = 0;
  for (let i = 0; i < all.length; i += 3) reach = Math.max(reach, Math.hypot(all[i] - target[0], all[i + 2] - target[2]));
  const tall = (max[1] - min[1]) / 2;
  // Seen from any side: as wide as the ground's reach, as tall as the reach tipped by the pitch plus the height.
  const distFor = (aspect: number) => {
    const half = Math.tan(FOV / 2);
    return Math.max(reach / (half * aspect), (reach * Math.sin(PITCH) + tall * Math.cos(PITCH)) / half) + reach * 0.35;
  };

  let width = 1;
  let height = 1;
  let dist = distFor(1);
  let yaw = YAW;
  let frame = 0;
  let last = 0;
  let disposed = false;
  const pointers = new Map<number, number>();

  const draw = (now: number) => {
    frame = 0;
    if (disposed || gl.isContextLost()) return;
    if (!still && !pointers.size && last) yaw -= (SPIN * Math.min(now - last, 100)) / 1000;
    last = now;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (height >= MIN_HEIGHT) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.uniformMatrix4fv(mvpAt, false, viewMatrix(target, dist, yaw, width / height));
      gl.uniform3f(offAt, 0, 0, 0);
      gl.enableVertexAttribArray(0);
      for (const { buffer, count, opacity } of layers) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.uniform4f(colorAt, color[0], color[1], color[2], opacity);
        gl.drawArrays(gl.LINES, 0, count);
      }
    }
    if (!still) request();
  };
  const request = () => {
    if (!frame && !disposed) frame = requestAnimationFrame(draw);
  };

  const resize = () => {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    dist = distFor(width / height);
    request();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  // Sideways only: the title scrolls on a short phone, and the host leaves up and down to the page (touch-action).
  const down = (event: PointerEvent) => {
    host.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, event.clientX);
  };
  const move = (event: PointerEvent) => {
    const from = pointers.get(event.pointerId);
    if (from === undefined) return;
    pointers.set(event.pointerId, event.clientX);
    yaw -= (event.clientX - from) * 0.0065;
    request();
  };
  const up = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    last = 0;
  };
  host.addEventListener("pointerdown", down);
  host.addEventListener("pointermove", move);
  host.addEventListener("pointerup", up);
  host.addEventListener("pointercancel", up);
  const lost = (event: Event) => {
    event.preventDefault();
    onLost();
  };
  canvas.addEventListener("webglcontextlost", lost);

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
      canvas.removeEventListener("webglcontextlost", lost);
      buffers.forEach((made) => gl.deleteBuffer(made));
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
