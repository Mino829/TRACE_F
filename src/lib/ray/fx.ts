/**
 * RAY prints and overlays.
 *
 * RayPrint copies a photo onto a small canvas, one cell per 2 CSS px, in its
 * own colours. tear() pulls the channels apart for a moment, and the brightest
 * point of the photo is kept in `ray` for the "RAY" mark.
 *
 * RayFX owns two full-screen canvases above the interface: a shutter that
 * drops 1-bit strips to hide a screen change, and a tear layer (difference
 * blend) for colour glitches, the negative flash and the negative split line
 * that turns the day screen into the room screen.
 */

const BAYER = (() => {
  const table = new Float32Array(64);
  const m = (bx: number, by: number) => 2 * bx + 3 * by - 4 * bx * by;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const value = 16 * m(x & 1, y & 1) + 4 * m((x >> 1) & 1, (y >> 1) & 1) + m((x >> 2) & 1, (y >> 2) & 1);
      table[y * 8 + x] = (value + 0.5) / 64;
    }
  }
  return table;
})();

const bayer = (x: number, y: number) => BAYER[(y & 7) * 8 + (x & 7)];

export function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function cellDevice(cell: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return { dpr, dev: Math.max(1, Math.round(cell * dpr)) };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The brightest small area of a picture's pixels, ignoring a thin border, as
 * fractions of its width and height: where the RAY mark goes.
 */
export function brightest(data: Uint8ClampedArray, width: number, height: number): { x: number; y: number } {
  let best = -1;
  let bestIndex = 0;
  for (let y = 1; y < height - 1; y += 1) {
    if (y < height * 0.08 || y > height * 0.92) continue;
    for (let x = 1; x < width - 1; x += 1) {
      if (x < width * 0.08 || x > width * 0.92) continue;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const j = ((y + dy) * width + x + dx) * 4;
          sum += 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
        }
      }
      if (sum > best) {
        best = sum;
        bestIndex = y * width + x;
      }
    }
  }
  return { x: ((bestIndex % width) + 0.5) / width, y: (Math.floor(bestIndex / width) + 0.5) / height };
}

export class RayPrint {
  readonly canvas: HTMLCanvasElement;
  ray = { x: 0.5, y: 0.5 };
  private img: HTMLImageElement;
  private cell: number;
  private ctx: CanvasRenderingContext2D | null;
  private width = 0;
  private height = 0;
  private orig: Uint8ClampedArray | null = null;
  private out: ImageData | null = null;

  constructor(img: HTMLImageElement, canvas: HTMLCanvasElement, cell = 2) {
    this.img = img;
    this.canvas = canvas;
    this.cell = cell;
    this.ctx = canvas.getContext("2d");
  }

  /** Fits the copy to a box in CSS px. Rebuilds only when the size really changes. */
  fit(cssWidth: number, cssHeight: number): this {
    if (!this.ctx) return this;
    const { dpr, dev } = cellDevice(this.cell);
    const width = Math.max(8, Math.round((cssWidth * dpr) / dev));
    const height = Math.max(8, Math.round((cssHeight * dpr) / dev));
    if (width === this.width && height === this.height) return this;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const iw = this.img.naturalWidth || this.img.width;
    const ih = this.img.naturalHeight || this.img.height;
    const scale = Math.max(width / iw, height / ih);
    ctx.drawImage(this.img, (width - iw * scale) / 2, (height - ih * scale) / 2, iw * scale, ih * scale);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, width, height).data;
    } catch {
      return this;
    }
    this.orig = new Uint8ClampedArray(data);
    this.out = ctx.createImageData(width, height);
    this.ray = brightest(data, width, height);
    return this;
  }

  /** glitch > 0 shifts a few rows and pulls red and blue to either side. */
  draw(glitch = 0, seed = 0): void {
    if (!this.ctx || !this.orig || !this.out) return;
    const { width, height } = this;
    const src = this.orig;
    const out = this.out.data;
    const dx = Math.round(glitch * 5);
    for (let y = 0; y < height; y += 1) {
      let shift = 0;
      if (glitch > 0.05) {
        let r = Math.sin((Math.floor(y / 6) + seed) * 12.9898) * 43758.5453;
        r -= Math.floor(r);
        if (r > 1 - glitch * 0.35) shift = Math.round((r - 0.5) * 22 * glitch);
      }
      for (let x = 0; x < width; x += 1) {
        const j = (y * width + x) * 4;
        const sx = Math.min(width - 1, Math.max(0, x - shift));
        const i = y * width + sx;
        const iR = dx ? y * width + Math.min(width - 1, sx + dx) : i;
        const iB = dx ? y * width + Math.max(0, sx - dx) : i;
        out[j] = src[iR * 4];
        out[j + 1] = src[i * 4 + 1];
        out[j + 2] = src[iB * 4 + 2];
        out[j + 3] = 255;
      }
    }
    this.ctx.putImageData(this.out, 0, 0);
  }

  /** A short colour tear on the photo itself. */
  tear(ms = 360, strength = 0.9): Promise<void> {
    if (reducedMotion() || !this.orig) return Promise.resolve();
    return new Promise((resolve) => {
      const t0 = performance.now();
      let last = 0;
      const step = (now: number) => {
        const progress = Math.min(1, (now - t0) / ms);
        if (now - last > 45 || progress >= 1) {
          last = now;
          const glitch = progress < 1 ? strength * (1 - progress) * (0.6 + 0.4 * Math.random()) : 0;
          this.draw(glitch, Math.floor(now / 45));
        }
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }
}

export class RayFX {
  private host: HTMLElement;
  private shutter: HTMLCanvasElement;
  private tearCanvas: HTMLCanvasElement;
  private sc: CanvasRenderingContext2D | null;
  private tc: CanvasRenderingContext2D | null;
  private cell: number;
  private width = 0;
  private height = 0;
  private img: ImageData | null = null;
  private buf: Uint32Array | null = null;
  private observer: ResizeObserver;

  constructor(host: HTMLElement, shutter: HTMLCanvasElement, tear: HTMLCanvasElement, cell = 2) {
    this.host = host;
    this.shutter = shutter;
    this.tearCanvas = tear;
    this.cell = cell;
    this.sc = shutter.getContext("2d");
    this.tc = tear.getContext("2d");
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  dispose(): void {
    this.observer.disconnect();
  }

  resize(): void {
    const rect = this.host.getBoundingClientRect();
    if (!rect.width || !this.sc) return;
    const { dpr, dev } = cellDevice(this.cell);
    const width = Math.ceil((rect.width * dpr) / dev);
    const height = Math.ceil((rect.height * dpr) / dev);
    this.width = width;
    this.height = height;
    for (const canvas of [this.shutter, this.tearCanvas]) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${(width * dev) / dpr}px`;
      canvas.style.height = `${(height * dev) / dpr}px`;
    }
    this.img = this.sc.createImageData(width, height);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  /** Drops 1-bit strips over the screen: "in" covers, "out" uncovers. */
  private shutterRun(phase: "in" | "out", color: string, ms: number): Promise<void> {
    const { sc, buf, img } = this;
    if (!sc || !buf || !img || reducedMotion()) {
      sc?.clearRect(0, 0, this.width, this.height);
      return Promise.resolve();
    }
    const cols = 9;
    const width = this.width;
    const height = this.height;
    const [r, g, b] = rgb(color);
    // ImageData is RGBA in memory; a Uint32 on little-endian hardware reads it as ABGR.
    const packed = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
    const delays = Array.from({ length: cols }, (_, i) => ((((Math.sin(i * 77.7 + 3.1) * 9999) % 1) + 1) % 1) * 0.35);
    const band = Math.round(height * 0.16);
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - t0) / ms);
        buf.fill(0);
        for (let c = 0; c < cols; c += 1) {
          const x0 = Math.floor((c * width) / cols);
          const x1 = Math.floor(((c + 1) * width) / cols);
          let q = Math.min(1, Math.max(0, (progress - delays[c]) / (1 - 0.35)));
          q = 1 - Math.pow(1 - q, 3);
          const top = phase === "in" ? -band : q * (height + band * 2) - band;
          const bottom = phase === "in" ? q * (height + band * 2) - band : height + band;
          for (let y = Math.max(0, Math.floor(top)); y < Math.min(height, Math.ceil(bottom + band)); y += 1) {
            const cover = phase === "in" ? (bottom - y) / band + 0.5 : (y - top) / band + 0.5;
            if (cover <= 0) continue;
            for (let x = x0; x < x1; x += 1) {
              if (cover >= 1 || cover > bayer(x, y)) buf[y * width + x] = packed;
            }
          }
        }
        sc.putImageData(img, 0, 0);
        if (progress < 1) requestAnimationFrame(step);
        else {
          if (phase === "out") sc.clearRect(0, 0, width, height);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** Covers, runs the swap while hidden, uncovers. Under reduced motion it is a cut. */
  async wipe(color: string, swap?: () => void | Promise<void>): Promise<void> {
    await this.shutterRun("in", color, 360);
    await swap?.();
    await this.shutterRun("out", color, 420);
  }

  /**
   * Colour tears: pure R, G, B blocks drawn with difference blending invert
   * one channel wherever they land, so colour shows only along the torn blocks.
   */
  tear(ms = 320, strength = 1): Promise<void> {
    const c = this.tc;
    if (!c || reducedMotion()) return Promise.resolve();
    const { width, height } = this;
    return new Promise((resolve) => {
      const t0 = performance.now();
      let last = 0;
      const step = (now: number) => {
        const progress = Math.min(1, (now - t0) / ms);
        if (now - last > 40) {
          last = now;
          c.clearRect(0, 0, width, height);
          const k = strength * (1 - progress);
          const count = Math.round(4 + 14 * k);
          for (let i = 0; i < count; i += 1) {
            const bw = Math.round(width * (0.08 + Math.random() * 0.5));
            const bh = Math.max(1, Math.round(height * (0.004 + Math.random() * 0.03)));
            const x = Math.round(Math.random() * (width - bw));
            const y = Math.round(Math.random() * height);
            c.fillStyle = ["#ff0000", "#00ff00", "#0000ff", "#ff00ff", "#00ffff"][i % 5];
            c.fillRect(x, y, bw, bh);
            if (i % 3 === 0) c.fillRect(x + Math.round((Math.random() - 0.5) * 8), y + bh + 1, Math.round(bw * 0.4), 1);
          }
        }
        if (progress < 1) requestAnimationFrame(step);
        else {
          c.clearRect(0, 0, width, height);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  /** The whole screen turns negative for a moment. swap is paper + ink, so paper and ink trade exactly. */
  flash(swap: string, ms = 90): Promise<void> {
    const c = this.tc;
    if (!c || reducedMotion()) return Promise.resolve();
    c.fillStyle = swap;
    c.fillRect(0, 0, this.width, this.height);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        c.clearRect(0, 0, this.width, this.height);
        resolve();
      }, ms);
    });
  }

  /**
   * The negative split: a hard line moves down the screen and everything
   * above it is inverted. When it reaches the bottom the caller swaps the real
   * colours, then calls clear().
   */
  split(swap: string, ms = 1400): Promise<void> {
    const c = this.tc;
    if (!c || reducedMotion()) return Promise.resolve();
    const { width, height } = this;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, (now - t0) / ms);
        const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        const y = Math.round(eased * height);
        c.clearRect(0, 0, width, height);
        c.fillStyle = swap;
        c.fillRect(0, 0, width, y);
        // A one-cell bright rule rides the line, with a little channel fringe.
        c.fillStyle = "#ff0000";
        c.fillRect(0, y, width, 1);
        c.fillStyle = "#00ffff";
        c.fillRect(Math.round(width * 0.3), y + 1, Math.round(width * 0.5), 1);
        if (progress < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  clear(): void {
    this.tc?.clearRect(0, 0, this.width, this.height);
    this.sc?.clearRect(0, 0, this.width, this.height);
  }
}
