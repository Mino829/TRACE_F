/**
 * The RAY field: the 1-bit background behind the participant screens.
 *
 * One WebGL1 canvas, two passes. SCENE draws light into R for one of three
 * scenes: 0 paper lit from the side, 1 one beam of light with a pool at one
 * end, 2 an image in a rectangle (the camera at the QR code). POST tears the
 * frame (strips, shear, blocks), splits the channels while glitching,
 * thresholds with an 8x8 ordered (Bayer) matrix and maps the bits to paper
 * and ink.
 *
 * With drift set, the light in a window (scene 0, framed) keeps moving: the
 * slats slide across it, the sun sways a little, and now and then a cloud's
 * shadow crosses it. The paper outside a window never carries dots.
 *
 * One canvas pixel is one dither cell. The canvas is sized so a cell covers a
 * whole number of device pixels, and CSS scales it with crisp edges, so the
 * pattern stays even on every phone. It draws only while something moves, at
 * about 30 fps (20 for a drifting window alone), and stops while the page is
 * hidden. Under reduced motion a window's light holds still.
 */

const VERT = "attribute vec2 aP;varying vec2 v;void main(){v=aP*0.5+0.5;gl_Position=vec4(aP,0.0,1.0);}";

const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
float h1(float n){ return fract(sin(n * 91.3458) * 47453.5453); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float m2(vec2 b){ return 2.0 * b.x + 3.0 * b.y - 4.0 * b.x * b.y; }
float bayer8(vec2 p){
  vec2 q = mod(floor(p), 8.0);
  vec2 b0 = mod(q, 2.0);
  vec2 b1 = mod(floor(q * 0.5), 2.0);
  vec2 b2 = floor(q * 0.25);
  return (16.0 * m2(b0) + 4.0 * m2(b1) + m2(b2) + 0.5) / 64.0;
}
`;

const SCENE = `${HEAD}
uniform vec2 uRes;
uniform float uTime;
uniform float uScene;
uniform float uSun, uGlow, uBands;
uniform vec4 uBeamAB;
uniform float uBeam, uGrow, uFlow, uPool, uPoolAt;
uniform vec2 uPoolR;
uniform sampler2D uImg;
uniform vec4 uRect;
uniform vec2 uCover;
uniform float uImgBg, uGain, uBias;
uniform vec4 uWin;
uniform vec2 uWinSoft;
uniform float uWinOn;
uniform float uDrift;
void main(){
  float asp = uRes.x / uRes.y;
  float L = 0.0;
  if (uScene < 0.5) {
    // Paper lit from one side: the far side gets sparse dots, soft bands of window light cross it.
    // With a window set, the same light is framed by that box and scaled to fit it.
    vec2 wc = mix(vec2(0.5), (uWin.xy + uWin.zw) * 0.5, uWinOn);
    float ws = mix(1.0, max(uWin.w - uWin.y, 0.05), uWinOn);
    // Drifting, the sun sways a little and the slats slide slowly across.
    float t = uTime * uDrift;
    vec2 q = (v - wc) * vec2(asp, 1.0) / ws;
    float sun = uSun + 0.09 * sin(t * 0.11);
    vec2 d = vec2(cos(sun), sin(sun));
    float x = dot(q, d);
    float shade = 1.0 - smoothstep(-0.55, 0.62, x);
    vec2 n = vec2(-d.y, d.x);
    float s = dot(q, n) * 5.5 + x * 0.6 - t * 0.04;
    float band = smoothstep(0.18, 0.02, abs(fract(s) - 0.5) - 0.22);
    shade *= 1.0 - uBands * band;
    // Every half a minute, the first after 18 s, a cloud's shadow comes in from the sun's side and crosses the window in a few seconds.
    float front = 2.2 - clamp(fract((t + 12.0) / 30.0) * 30.0 / 9.0, 0.0, 1.0) * 4.4;
    float cloud = uDrift * (1.0 - smoothstep(0.25, 0.75, abs(x - front)));
    shade = mix(shade, 0.92, cloud * 0.5);
    vec2 lo = smoothstep(uWin.xy - uWinSoft, uWin.xy + uWinSoft, v);
    vec2 hi = 1.0 - smoothstep(uWin.zw - uWinSoft, uWin.zw + uWinSoft, v);
    float inWin = lo.x * lo.y * hi.x * hi.y;
    shade *= mix(1.0, inWin, uWinOn);
    L = 1.0 - uGlow * shade * 0.3;
  } else if (uScene < 1.5) {
    // One straight beam, and an oval pool of light at one of its ends. uGrow draws it from its start.
    vec2 S = vec2(asp, 1.0);
    vec2 p = v * S;
    vec2 a = uBeamAB.xy * S;
    vec2 b = mix(uBeamAB.xy, uBeamAB.zw, uGrow) * S;
    float len = max(length(b - a), 0.0001);
    vec2 dir = (b - a) / len;
    float t = clamp(dot(p - a, dir), 0.0, len);
    float d = length(p - a - dir * t);
    float core = 1.0 - smoothstep(0.003, 0.007, d);
    float halo = (1.0 - smoothstep(0.0, 0.026 + t * 0.02, d)) * 0.36;
    float pulse = 0.82 + 0.18 * sin(t * 30.0 - uTime * uFlow);
    float beam = uBeam * max(core, halo) * pulse * step(0.002, uGrow);
    vec2 c = mix(uBeamAB.xy, uBeamAB.zw, uPoolAt) * S;
    float r = length((p - c) / uPoolR);
    float pool = uPool * max((1.0 - smoothstep(0.1, 1.0, r)) * 0.6, 1.0 - smoothstep(0.0, 0.24, r));
    L = max(beam, pool);
  } else {
    vec2 iuv = (v - uRect.xy) / (uRect.zw - uRect.xy);
    if (iuv.x >= 0.0 && iuv.x <= 1.0 && iuv.y >= 0.0 && iuv.y <= 1.0) {
      vec2 c = (iuv - 0.5) * uCover + 0.5;
      vec3 col = texture2D(uImg, vec2(c.x, 1.0 - c.y)).rgb;
      L = clamp(dot(col, vec3(0.299, 0.587, 0.114)) * uGain + uBias, 0.0, 1.0);
    } else {
      L = uImgBg;
    }
  }
  gl_FragColor = vec4(L, 0.0, 0.0, 1.0);
}`;

const POST = `${HEAD}
uniform sampler2D uSceneTex;
uniform float uTime;
uniform float uInvert, uSplitOn, uSplitY;
uniform float uGlitch, uSlice, uShear, uCols, uRows;
uniform vec3 uPaper, uInk;
void main(){
  vec2 uv = v;
  float col = floor(uv.x * uCols);
  uv.y += (h1(col + 3.0) - 0.5) * uSlice;
  float row = floor(uv.y * uRows);
  uv.x += (h1(row + 17.0) - 0.5) * uShear;
  float tick = floor(uTime * 10.0);
  vec2 blk = floor(uv * vec2(8.0, 15.0));
  float g = h2(blk + vec2(tick * 0.618, tick * 0.27));
  float on = step(1.0 - 0.42 * uGlitch, g) * step(0.015, uGlitch);
  uv += on * (vec2(h1(g * 13.1), h1(g * 7.7)) - 0.5) * vec2(0.22, 0.04) * uGlitch;
  float ca = (0.016 * on + 0.004) * uGlitch;
  vec3 L = vec3(texture2D(uSceneTex, uv + vec2(ca, 0.0)).r, texture2D(uSceneTex, uv).r, texture2D(uSceneTex, uv - vec2(ca, 0.0)).r);
  L = clamp(L, 0.0, 1.0);
  float b = bayer8(gl_FragCoord.xy);
  vec3 bits = step(vec3(b), L);
  // The whole-frame inversion dissolves through a second ordered pattern, so even a fade stays 1-bit.
  float inv = step(bayer8(gl_FragCoord.xy + vec2(3.0, 6.0)), uInvert);
  inv = abs(inv - uSplitOn * step(uSplitY, v.y));
  bits = mix(bits, 1.0 - bits, inv);
  gl_FragColor = vec4(mix(uInk, uPaper, bits), 1.0);
}`;

type Vec2 = [number, number];
type Vec4 = [number, number, number, number];

/** Everything the two passes read. Positions are in uv: 0..1, y up. */
export type FieldValues = {
  scene: number;
  sun: number;
  glow: number;
  bands: number;
  beamA: Vec2;
  beamB: Vec2;
  beam: number;
  grow: number;
  flow: number;
  pool: number;
  poolAt: number;
  poolR: Vec2;
  imgBg: number;
  gain: number;
  bias: number;
  win: Vec4;
  winSoft: Vec2;
  winOn: number;
  /** 1 keeps a window's light moving; 0 holds it still once it is up. */
  drift: number;
  rect: Vec4;
  cover: Vec2;
  invert: number;
  splitOn: number;
  splitY: number;
  glitch: number;
  slice: number;
  shear: number;
  cols: number;
  rows: number;
  paper: [number, number, number];
  ink: [number, number, number];
};

export type FieldProps = Partial<FieldValues>;

const DEFAULTS: FieldValues = {
  scene: 0,
  sun: 2.4,
  glow: 0,
  bands: 0,
  beamA: [0.5, 0.4],
  beamB: [0.5, 1.3],
  beam: 0,
  grow: 1,
  flow: 0,
  pool: 0,
  poolAt: 0,
  poolR: [0.08, 0.02],
  imgBg: 0,
  gain: 1,
  bias: 0,
  win: [0, 0, 1, 1],
  winSoft: [0.0001, 0.0001],
  winOn: 0,
  drift: 0,
  rect: [0, 0, 1, 1],
  cover: [1, 1],
  invert: 0,
  splitOn: 0,
  splitY: 0.5,
  glitch: 0,
  slice: 0,
  shear: 0,
  cols: 18,
  rows: 26,
  paper: [0.827, 0.835, 0.827],
  ink: [0.047, 0.047, 0.051],
};

export type Ease = "linear" | "out" | "inOut" | "in";

const EASE: Record<Ease, (t: number) => number> = {
  linear: (t) => t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  in: (t) => t * t * t,
};

type NumericKey = { [K in keyof FieldValues]: FieldValues[K] extends number | number[] ? K : never }[keyof FieldValues];
type Tween = { from: FieldProps; to: FieldProps; t0: number; ms: number; ease: (t: number) => number; done: () => void };

const SCENE_UNIFORMS = ["uRes", "uTime", "uScene", "uSun", "uGlow", "uBands", "uBeamAB", "uBeam", "uGrow", "uFlow", "uPool", "uPoolAt", "uPoolR", "uImg", "uRect", "uCover", "uImgBg", "uGain", "uBias", "uWin", "uWinSoft", "uWinOn", "uDrift"] as const;
const POST_UNIFORMS = ["uSceneTex", "uTime", "uInvert", "uSplitOn", "uSplitY", "uGlitch", "uSlice", "uShear", "uCols", "uRows", "uPaper", "uInk"] as const;

function reducedQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
}

export class RayField {
  readonly canvas: HTMLCanvasElement;
  readonly u: FieldValues = structuredClone(DEFAULTS);
  /** Called on every animation frame, before drawing: for live sources such as the camera stand-in. */
  private onFrame: ((dt: number) => void) | null = null;
  /** Keeps drawing every frame while set. */
  private live = false;
  reduced: boolean;
  ok = false;
  size: Vec2 = [1, 1];

  private host: HTMLElement;
  private cell: number;
  private gl: WebGLRenderingContext | null = null;
  private pScene: WebGLProgram | null = null;
  private pPost: WebGLProgram | null = null;
  private sLoc: Record<string, WebGLUniformLocation | null> = {};
  private pLoc: Record<string, WebGLUniformLocation | null> = {};
  private sceneTex: WebGLTexture | null = null;
  private imgTex: WebGLTexture | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private tweens: Tween[] = [];
  private glitchGoal = 0;
  private sliceGoal = 0;
  private imageLive = false;
  private time = 0;
  private last = 0;
  private lastDraw = 0;
  private raf = 0;
  private dirty = true;
  private disposers: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement, host: HTMLElement, cell = 2) {
    this.canvas = canvas;
    this.host = host;
    this.cell = cell;
    const query = reducedQuery();
    this.reduced = !!query?.matches;
    this.ok = this.init();

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(host);
    const onVisible = () => {
      if (!document.hidden) this.wake();
    };
    document.addEventListener("visibilitychange", onVisible);
    const onQuery = () => {
      this.reduced = !!query?.matches;
      this.wake();
    };
    query?.addEventListener("change", onQuery);
    const onLost = (event: Event) => {
      event.preventDefault();
      this.ok = false;
    };
    const onRestored = () => {
      this.ok = this.init();
      this.resize();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    this.disposers.push(
      () => observer.disconnect(),
      () => document.removeEventListener("visibilitychange", onVisible),
      () => query?.removeEventListener("change", onQuery),
      () => canvas.removeEventListener("webglcontextlost", onLost),
      () => canvas.removeEventListener("webglcontextrestored", onRestored),
    );
    this.resize();
  }

  /** Stops drawing. release also hands the GPU context back, for a canvas that is thrown away with it. */
  dispose(release = false): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.disposers.forEach((dispose) => dispose());
    this.disposers = [];
    this.tweens.forEach((tween) => tween.done());
    this.tweens = [];
    if (release) this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private init(): boolean {
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = this.canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "low-power" });
    } catch {
      gl = null;
    }
    // Without WebGL the plain page colour shows through; nothing on the screen depends on the field.
    if (!gl) {
      this.canvas.style.display = "none";
      return false;
    }
    this.gl = gl;
    const shader = (type: number, source: string) => {
      const created = gl.createShader(type);
      if (!created) return null;
      gl.shaderSource(created, source);
      gl.compileShader(created);
      return gl.getShaderParameter(created, gl.COMPILE_STATUS) ? created : null;
    };
    const program = (fragment: string) => {
      const vertexShader = shader(gl.VERTEX_SHADER, VERT);
      const fragmentShader = shader(gl.FRAGMENT_SHADER, fragment);
      const created = gl.createProgram();
      if (!created || !vertexShader || !fragmentShader) return null;
      gl.attachShader(created, vertexShader);
      gl.attachShader(created, fragmentShader);
      gl.bindAttribLocation(created, 0, "aP");
      gl.linkProgram(created);
      return gl.getProgramParameter(created, gl.LINK_STATUS) ? created : null;
    };
    this.pScene = program(SCENE);
    this.pPost = program(POST);
    if (!this.pScene || !this.pPost) {
      this.canvas.style.display = "none";
      return false;
    }
    this.sLoc = Object.fromEntries(SCENE_UNIFORMS.map((name) => [name, gl.getUniformLocation(this.pScene!, name)]));
    this.pLoc = Object.fromEntries(POST_UNIFORMS.map((name) => [name, gl.getUniformLocation(this.pPost!, name)]));
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.sceneTex = this.texture();
    this.fbo = gl.createFramebuffer();
    this.imgTex = this.texture();
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return true;
  }

  private texture(): WebGLTexture | null {
    const gl = this.gl!;
    const created = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, created);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return created;
  }

  resize(): void {
    const rect = this.host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const cellDevice = Math.max(1, Math.round(this.cell * dpr));
    const width = Math.ceil((rect.width * dpr) / cellDevice);
    const height = Math.ceil((rect.height * dpr) / cellDevice);
    this.size = [width, height];
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.width = `${(width * cellDevice) / dpr}px`;
    this.canvas.style.height = `${(height * cellDevice) / dpr}px`;
    if (this.ok && this.gl) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.dirty = true;
    this.wake();
  }

  /** Sets values at once. A value set directly wins over a tween still running on it. */
  set(props: FieldProps): this {
    this.tweens = this.tweens.filter((tween) => !Object.keys(props).some((key) => key in tween.to));
    Object.assign(this.u, structuredClone(props));
    this.dirty = true;
    this.wake();
    return this;
  }

  /** Tweens numeric values; resolves when done. Under reduced motion it jumps. */
  to(props: Partial<Pick<FieldValues, NumericKey>>, ms: number, ease: Ease = "inOut"): Promise<void> {
    if (this.reduced || !ms) {
      this.set(props);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const from: FieldProps = {};
      for (const key of Object.keys(props) as NumericKey[]) {
        (from as Record<string, unknown>)[key] = structuredClone(this.u[key]);
        this.tweens = this.tweens.filter((tween) => !(key in tween.to));
      }
      this.tweens.push({ from, to: props, t0: performance.now(), ms, ease: EASE[ease], done: resolve });
      this.wake();
    });
  }

  /**
   * Frames the paper light (scene 0) by a box in client px, such as an
   * element's bounding rect; null lights the whole field again. soft is the
   * width of the dithered edge in px.
   */
  window(rect: DOMRect | null, soft = 0): this {
    if (!rect) {
      this.u.winOn = 0;
    } else {
      const canvas = this.canvas.getBoundingClientRect();
      if (!canvas.width || !canvas.height) return this;
      this.u.win = [(rect.left - canvas.left) / canvas.width, 1 - (rect.bottom - canvas.top) / canvas.height, (rect.right - canvas.left) / canvas.width, 1 - (rect.top - canvas.top) / canvas.height];
      this.u.winSoft = [Math.max(0.0001, soft / canvas.width), Math.max(0.0001, soft / canvas.height)];
      this.u.winOn = 1;
    }
    this.dirty = true;
    this.wake();
    return this;
  }

  /** A burst of glitch: colour tears for a moment, then heals. */
  burst(amount = 0.9): void {
    if (this.reduced) return;
    this.glitchGoal = Math.max(this.glitchGoal, amount);
    this.sliceGoal = Math.max(this.sliceGoal, amount * 0.08);
    this.wake();
  }

  /** Swipe velocity in px per frame: fast motion tears the field. */
  kick(velocity: number): void {
    if (this.reduced) return;
    this.glitchGoal = Math.max(this.glitchGoal, Math.min(Math.abs(velocity) * 0.012, 0.7));
    this.sliceGoal = Math.max(this.sliceGoal, Math.min(Math.abs(velocity) * 0.0012, 0.08));
    this.wake();
  }

  /** The image for scene 2: an image or canvas. Call again each frame for a live source. */
  image(source: TexImageSource & { width: number; height: number }, rect: Vec4 | null, live: boolean): void {
    if (!this.ok || !this.gl) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return;
    }
    if (rect) this.u.rect = rect;
    const [x0, y0, x1, y1] = this.u.rect;
    const boxAspect = ((x1 - x0) * this.size[0]) / ((y1 - y0) * this.size[1]);
    const imageAspect = source.width / source.height;
    this.u.cover = imageAspect > boxAspect ? [boxAspect / imageAspect, 1] : [1, imageAspect / boxAspect];
    this.imageLive = live;
    this.dirty = true;
    this.wake();
  }

  stopImage(): void {
    this.imageLive = false;
  }

  /** Draws every frame, calling onFrame first, until it is called again with null. */
  follow(onFrame: ((dt: number) => void) | null): void {
    this.onFrame = onFrame;
    this.live = onFrame !== null;
    this.wake();
  }

  wake(): void {
    if (!this.raf && !document.hidden) this.raf = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number): void {
    this.raf = 0;
    if (document.hidden) return;
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0.016;
    this.last = now;
    this.time += dt;

    for (let index = this.tweens.length - 1; index >= 0; index -= 1) {
      const tween = this.tweens[index];
      const progress = Math.min(1, (now - tween.t0) / tween.ms);
      const eased = tween.ease(progress);
      for (const key of Object.keys(tween.to) as NumericKey[]) {
        const from = tween.from[key] as number | number[];
        const to = tween.to[key] as number | number[];
        (this.u as Record<string, unknown>)[key] = Array.isArray(to) ? to.map((value, j) => (from as number[])[j] + (value - (from as number[])[j]) * eased) : (from as number) + (to - (from as number)) * eased;
      }
      if (progress >= 1) {
        this.tweens.splice(index, 1);
        tween.done();
      }
    }

    // Glitch: fast attack, slow release. Stillness heals the frame.
    let glitch = this.u.glitch;
    glitch += (this.glitchGoal - glitch) * (this.glitchGoal > glitch ? 0.5 : 0.11);
    this.glitchGoal *= 0.86;
    if (glitch < 0.002 && this.glitchGoal < 0.002) {
      glitch = 0;
      this.glitchGoal = 0;
    }
    this.u.glitch = glitch;
    let slice = this.u.slice;
    slice += (this.sliceGoal - slice) * 0.2;
    this.sliceGoal *= 0.85;
    if (Math.abs(slice) < 0.0005 && this.sliceGoal < 0.0005) {
      slice = 0;
      this.sliceGoal = 0;
    }
    this.u.slice = slice;

    // A still beam is drawn once; it needs new frames only while light flows along it.
    const flowing = this.u.scene === 1 && !this.reduced && this.u.beam > 0.01 && this.u.flow > 0;
    const busy = this.tweens.length > 0 || glitch > 0 || slice > 0 || flowing || this.imageLive || this.live;
    // A drifting window is slow: fewer frames do.
    const drifting = !this.reduced && this.u.drift > 0 && this.u.winOn > 0 && this.u.scene === 0;
    this.onFrame?.(dt);
    if ((this.dirty || busy || drifting) && (now - this.lastDraw > (busy ? 30 : 50) || !(busy || drifting))) {
      this.draw();
      this.lastDraw = now;
      this.dirty = false;
    }
    if (busy || drifting || this.dirty) this.wake();
  }

  private draw(): void {
    if (!this.ok || !this.gl) return;
    const gl = this.gl;
    const u = this.u;
    const s = this.sLoc;
    const p = this.pLoc;
    const [width, height] = this.size;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.pScene);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.imgTex);
    gl.uniform1i(s.uImg, 1);
    gl.uniform2f(s.uRes, width, height);
    gl.uniform1f(s.uTime, this.reduced ? 1 : this.time);
    gl.uniform1f(s.uScene, u.scene);
    gl.uniform1f(s.uSun, u.sun);
    gl.uniform1f(s.uGlow, u.glow);
    gl.uniform1f(s.uBands, u.bands);
    gl.uniform4f(s.uBeamAB, u.beamA[0], u.beamA[1], u.beamB[0], u.beamB[1]);
    gl.uniform1f(s.uBeam, u.beam);
    gl.uniform1f(s.uGrow, u.grow);
    gl.uniform1f(s.uFlow, u.flow);
    gl.uniform1f(s.uPool, u.pool);
    gl.uniform1f(s.uPoolAt, u.poolAt);
    gl.uniform2f(s.uPoolR, u.poolR[0], u.poolR[1]);
    gl.uniform4f(s.uRect, ...u.rect);
    gl.uniform2f(s.uCover, u.cover[0], u.cover[1]);
    gl.uniform1f(s.uImgBg, u.imgBg);
    gl.uniform1f(s.uGain, u.gain);
    gl.uniform1f(s.uBias, u.bias);
    gl.uniform4f(s.uWin, ...u.win);
    gl.uniform2f(s.uWinSoft, u.winSoft[0], u.winSoft[1]);
    gl.uniform1f(s.uWinOn, u.winOn);
    gl.uniform1f(s.uDrift, u.drift);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.pPost);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(p.uSceneTex, 0);
    gl.uniform1f(p.uTime, this.time);
    gl.uniform1f(p.uInvert, u.invert);
    gl.uniform1f(p.uSplitOn, u.splitOn);
    gl.uniform1f(p.uSplitY, u.splitY);
    gl.uniform1f(p.uGlitch, u.glitch);
    gl.uniform1f(p.uSlice, u.slice);
    gl.uniform1f(p.uShear, u.shear);
    gl.uniform1f(p.uCols, u.cols);
    gl.uniform1f(p.uRows, u.rows);
    gl.uniform3fv(p.uPaper, u.paper);
    gl.uniform3fv(p.uInk, u.ink);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
