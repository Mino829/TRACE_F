/**
 * The little WebGL the campus map needs, without a library: one context, and
 * two tiny programs (lines and triangles; round points). Everything the map
 * draws is flat colour with an opacity, so there is nothing else to ship.
 */

/** True when this browser can make a WebGL context at all; the map falls back to a list when it cannot. */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * A context made for drawing a few lines: no antialiasing, transparent where nothing is drawn. `stencil` adds a
 * stencil buffer, so a floor with a hole in it (a light well) is filled round the hole.
 */
export function getContext(canvas: HTMLCanvasElement, stencil = false): WebGLRenderingContext | null {
  const options: WebGLContextAttributes = { antialias: false, alpha: true, depth: false, stencil, premultipliedAlpha: true, powerPreference: "low-power", preserveDrawingBuffer: false };
  return canvas.getContext("webgl", options) ?? (canvas.getContext("experimental-webgl", options) as WebGLRenderingContext | null);
}

export function compileProgram(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram {
  const make = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("シェーダーを作れませんでした。");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "";
      gl.deleteShader(shader);
      throw new Error(`シェーダーをコンパイルできませんでした: ${log}`);
    }
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error("プログラムを作れませんでした。");
  const v = make(gl.VERTEX_SHADER, vertex);
  const f = make(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  // Both programs read their one attribute from slot 0, so it can stay enabled across them.
  gl.bindAttribLocation(program, 0, "a_pos");
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "";
    gl.deleteProgram(program);
    throw new Error(`プログラムをリンクできませんでした: ${log}`);
  }
  return program;
}

/** Lines and triangles: flat colour, moved by an offset (so floors with the same outline share one buffer). */
export const LINE_VERTEX = `
attribute vec3 a_pos;
uniform mat4 u_mvp;
uniform vec3 u_off;
void main() { gl_Position = u_mvp * vec4(a_pos + u_off, 1.0); }
`;

export const LINE_FRAGMENT = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = vec4(u_color.rgb * u_color.a, u_color.a); }
`;

/** Round points: u_kind 0 is a dot with a soft halo, 1 is two rings. */
export const POINT_VERTEX = `
attribute vec3 a_pos;
uniform mat4 u_mvp;
uniform float u_size;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); gl_PointSize = u_size; }
`;

export const POINT_FRAGMENT = `
precision mediump float;
uniform vec4 u_color;
uniform float u_kind;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a;
  if (u_kind < 0.5) {
    float core = 1.0 - smoothstep(0.44, 0.52, d);
    float halo = 0.22 * (1.0 - smoothstep(0.5, 1.0, d));
    a = max(core, halo);
  } else {
    float outer = 1.0 - smoothstep(0.06, 0.13, abs(d - 0.8));
    float inner = 0.8 * (1.0 - smoothstep(0.02, 0.06, abs(d - 0.55)));
    a = max(outer, inner);
  }
  a *= u_color.a;
  gl_FragColor = vec4(u_color.rgb * a, a);
}
`;

