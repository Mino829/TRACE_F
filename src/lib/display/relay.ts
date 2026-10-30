/**
 * The light between the visitor's phone and the booth's screen, drawn on one
 * 2D canvas over the booth's screens (under the HUD). The phone's side is
 * src/components/ping-log/ray/relay.tsx.
 *
 * - arrive: the room goes dark and a glow wakes at the foot of the screen,
 *   where the visitor stands with the phone. Then the light the phone sent
 *   shoots up from there and lands where the walk begins (the head of the
 *   line, in the middle of the drone view). It resolves as it lands, so the
 *   line grows out of that light.
 * - release: at the end of the walk the light gathers at the head of the line
 *   and pours out of the foot of the screen, back to the phone, where it falls
 *   in from the top edge and gathers in the ring.
 *
 * The phone and the booth share no clock, only TRACE_B. The phone sends its
 * light about RELAY_ENTERS_MS after the arrival reaches TRACE_B (the scan
 * screen's exit, then the launch), so the light comes in here then. At the end
 * the phone learns the replay is over by asking TRACE_B every few seconds, so
 * the light keeps pouring for most of the arrived card's hold, and is still
 * pouring when the phone hears of it.
 *
 * RAY is black and white: the light is the paper white of the line, soft
 * glows added on top of each other, with an ink veil while the room is dark.
 */

export type Point = { x: number; y: number };

/** From the start of an arrival to the light coming in at the foot of the screen. */
export const RELAY_ENTERS_MS = 3500;
const DARKEN_MS = 700;
const FLIGHT_MS = 1900;
/** From the start of an arrival to the light landing, when the walk begins. */
export const RELAY_LANDS_MS = RELAY_ENTERS_MS + FLIGHT_MS;
const LAND_MS = 900;
const GATHER_MS = 750;
/** One drop's way from the head of the line out of the foot of the screen. */
const POUR_MS = 1400;
/**
 * Drops keep leaving for this long after the first. The last is out before the
 * arrived card's hold ends (4 s, renderer-link.ts), which clears the light.
 */
const STREAM_MS = 1700;
const DROPS = 72;

const INK = "12, 12, 13";

export interface Relay {
  /** The visitor's light comes in and lands at `to()`. Resolves true as it lands, false if cleared first. */
  arrive(to: () => Point, signal?: AbortSignal): Promise<boolean>;
  /** The light gathers at `from()` and pours out of the foot of the screen. */
  release(from: () => Point): void;
  /** Takes every light off at once (the booth is back at its QR). */
  clear(): void;
  dispose(): void;
}

/** One effect: draws a frame at `now` and says whether it goes on. */
type Effect = { draw: (now: number) => boolean; cancel: () => void };

type Spark = { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number };

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Slows into the end more gently than easeOut, so a long flight keeps moving until it lands. */
const glide = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function bezier(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

/** A soft round glow, drawn once and scaled: far cheaper than a gradient or a blur per light. */
function glowSprite(): HTMLCanvasElement {
  const size = 128;
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const context = sprite.getContext("2d");
  if (!context) return sprite;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(245, 247, 246, 1)");
  gradient.addColorStop(0.18, "rgba(235, 238, 236, 0.62)");
  gradient.addColorStop(0.45, "rgba(211, 213, 211, 0.2)");
  gradient.addColorStop(1, "rgba(211, 213, 211, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return sprite;
}

export function createRelay(canvas: HTMLCanvasElement): Relay {
  const context = canvas.getContext("2d");
  const sprite = glowSprite();
  let effects: Effect[] = [];
  let raf = 0;
  let width = 0;
  let height = 0;
  let ratio = 1;

  const resize = () => {
    ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  /** A light of radius r (px) at alpha a, added to what is there. */
  const light = (x: number, y: number, r: number, a: number) => {
    if (!context || a <= 0.004 || r <= 0.5) return;
    context.globalAlpha = Math.min(1, a);
    context.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  };
  /** The hard white middle of a light. */
  const core = (x: number, y: number, r: number, a: number) => {
    if (!context || a <= 0.004 || r <= 0.2) return;
    context.globalAlpha = Math.min(1, a);
    context.fillStyle = "rgb(246, 248, 247)";
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  };
  const veil = (a: number) => {
    if (!context || a <= 0.004) return;
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.fillStyle = `rgba(${INK}, ${Math.min(1, a)})`;
    context.fillRect(0, 0, width, height);
  };
  const sparks = (list: Spark[], now: number, dt: number) => {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const spark = list[index];
      const age = (now - spark.born) / spark.life;
      if (age >= 1) {
        list.splice(index, 1);
        continue;
      }
      const drag = Math.pow(0.04, dt);
      spark.vx *= drag;
      spark.vy *= drag;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      light(spark.x, spark.y, spark.size * 3.2, 0.5 * (1 - age));
      core(spark.x, spark.y, spark.size * 0.45, 0.85 * (1 - age) * (1 - age));
    }
  };

  let last = 0;
  const frame = (now: number) => {
    raf = 0;
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.clearRect(0, 0, width, height);
    effects = effects.filter((effect) => effect.draw(now));
    context.globalAlpha = 1;
    last = now;
    if (effects.length) raf = requestAnimationFrame(frame);
  };
  const run = (effect: Effect) => {
    effects.push(effect);
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const step = (now: number) => (last ? Math.min(0.05, (now - last) / 1000) : 1 / 60);

  return {
    arrive(to, signal) {
      return new Promise<boolean>((resolve) => {
        if (signal?.aborted) return resolve(false);
        const start = performance.now();
        const flying: Spark[] = [];
        let landed = false;
        let ended = false;
        const finish = (value: boolean) => {
          if (ended) return;
          ended = true;
          resolve(value);
        };
        const effect: Effect = {
          cancel: () => finish(false),
          draw: (now) => {
            const t = now - start;
            const dt = step(now);
            const h = height;
            const foot: Point = { x: width / 2, y: h + h * 0.04 };
            const target = to();
            // The room darkens, stays dark while the light is on its way, and opens on the walk once it lands.
            const open = clamp01((t - RELAY_LANDS_MS) / LAND_MS);
            veil(easeOut(clamp01(t / DARKEN_MS)) * (1 - easeInOut(open)));
            context!.globalCompositeOperation = "lighter";

            // The foot of the screen wakes: the phone below is about to send its light.
            if (t < RELAY_ENTERS_MS + 500) {
              const ramp = easeIn(clamp01((t - DARKEN_MS * 0.4) / (RELAY_ENTERS_MS - DARKEN_MS * 0.4)));
              const out = 1 - clamp01((t - RELAY_ENTERS_MS) / 500);
              const breath = 0.5 + 0.5 * Math.sin((t / 1000) * Math.PI * 2 * 0.9);
              light(foot.x, foot.y, h * (0.18 + 0.12 * ramp), (0.18 + 0.5 * ramp + 0.1 * breath * ramp) * out);
              if (Math.random() < 0.7 * ramp * out) {
                flying.push({ x: foot.x + (Math.random() - 0.5) * h * 0.22, y: h, vx: (Math.random() - 0.5) * 20, vy: -h * (0.12 + Math.random() * 0.14), born: now, life: 700 + Math.random() * 700, size: 1.2 + Math.random() * 1.6 });
              }
            }

            // The light comes in from the foot and lands at the target.
            if (t >= RELAY_ENTERS_MS && t < RELAY_LANDS_MS + LAND_MS) {
              const path = (u: number) =>
                bezier({ x: foot.x, y: h + 30 }, { x: foot.x, y: h * 0.6 }, { x: target.x, y: target.y + h * 0.3 }, target, u);
              const u = glide(clamp01((t - RELAY_ENTERS_MS) / FLIGHT_MS));
              const head = path(u);
              const fading = 1 - easeOut(open);
              // The way it came, brightest at the head.
              const tail = Math.max(0, u - 0.3);
              for (let k = 0; k <= 32; k += 1) {
                const f = k / 32;
                const at = path(tail + (u - tail) * f);
                light(at.x, at.y, h * (0.01 + 0.04 * f), (0.1 + 0.55 * f * f) * fading);
              }
              if (!landed) {
                light(head.x, head.y, h * 0.13, 1);
                light(head.x, head.y, h * 0.04, 1);
                core(head.x, head.y, h * 0.009, 1);
                for (let k = 0; k < 3; k += 1) {
                  const angle = Math.random() * Math.PI * 2;
                  const speed = h * (0.05 + Math.random() * 0.12);
                  flying.push({ x: head.x, y: head.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed + h * 0.08, born: now, life: 500 + Math.random() * 500, size: 1 + Math.random() * 1.8 });
                }
              } else {
                // Landed: a flash and a ring that run out, and the light settles into the head of the line.
                const p = easeOut(open);
                light(target.x, target.y, h * (0.13 + 0.5 * p), (1 - p) * (1 - p));
                light(target.x, target.y, h * (0.13 - 0.08 * p), 1 - p);
                core(target.x, target.y, h * 0.009 * (1 - p), 1 - p);
                context!.globalAlpha = 0.65 * (1 - p);
                context!.strokeStyle = "rgb(235, 238, 236)";
                context!.lineWidth = 2;
                context!.beginPath();
                context!.arc(target.x, target.y, h * (0.03 + 0.3 * p), 0, Math.PI * 2);
                context!.stroke();
              }
              if (!landed && t >= RELAY_LANDS_MS) {
                landed = true;
                for (let k = 0; k < 36; k += 1) {
                  const angle = (k / 36) * Math.PI * 2 + Math.random() * 0.2;
                  const speed = h * (0.18 + Math.random() * 0.25);
                  flying.push({ x: target.x, y: target.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: now, life: 600 + Math.random() * 600, size: 1.2 + Math.random() * 1.8 });
                }
                finish(true);
              }
            }

            sparks(flying, now, dt);
            return t < RELAY_LANDS_MS + LAND_MS || flying.length > 0;
          },
        };
        signal?.addEventListener(
          "abort",
          () => {
            effects = effects.filter((other) => other !== effect);
            finish(false);
          },
          { once: true },
        );
        run(effect);
      });
    },

    release(from) {
      const start = performance.now();
      const h = height || 1;
      // Motes around the head of the line, drawn in to it.
      const motes = Array.from({ length: 44 }, () => ({
        angle: Math.random() * Math.PI * 2,
        reach: h * (0.1 + Math.random() * 0.24),
        delay: Math.random() * 220,
        size: 1 + Math.random() * 1.8,
      }));
      // Drops leave densely at first, then fewer and fewer; the first is the light itself.
      const drops = Array.from({ length: DROPS }, (_, k) => ({
        leaves: GATHER_MS + STREAM_MS * Math.pow(k / DROPS, 1.7),
        drift: (Math.random() - 0.5) * 2,
        size: k === 0 ? h * 0.1 : h * (0.016 + Math.random() * 0.026),
        strength: k === 0 ? 1 : (0.55 + Math.random() * 0.45) * (1 - (k / DROPS) * 0.5),
      }));
      const end = GATHER_MS + STREAM_MS + POUR_MS;
      const flying: Spark[] = [];
      run({
        cancel: () => undefined,
        draw: (now) => {
          const t = now - start;
          const dt = step(now);
          const head = from();
          const foot: Point = { x: width / 2, y: height + 40 };
          const path = (u: number, drift: number) => {
            const at = bezier(head, { x: head.x, y: head.y + h * 0.3 }, { x: foot.x, y: h * 0.78 }, foot, u);
            return { x: at.x + drift * Math.sin(u * Math.PI) * width * 0.035, y: at.y };
          };
          context!.globalCompositeOperation = "lighter";

          // The light gathers at the head of the line, then fades as it pours away.
          const swell = easeInOut(clamp01(t / GATHER_MS));
          const away = easeOut(clamp01((t - GATHER_MS) / 1700));
          light(head.x, head.y, h * (0.05 + 0.09 * swell), (0.5 + 0.5 * swell) * (1 - away));
          light(head.x, head.y, h * 0.035, (0.4 + 0.6 * swell) * (1 - away));
          core(head.x, head.y, h * 0.008 * (1 - away), (0.6 + 0.4 * swell) * (1 - away));
          for (const mote of motes) {
            const p = clamp01((t - mote.delay) / (GATHER_MS - mote.delay));
            if (p <= 0 || p >= 1) continue;
            const r = mote.reach * (1 - easeIn(p));
            const x = head.x + Math.cos(mote.angle) * r;
            const y = head.y + Math.sin(mote.angle) * r;
            light(x, y, mote.size * 3.4, 0.55 * Math.sin(p * Math.PI));
            core(x, y, mote.size * 0.5, 0.8 * Math.sin(p * Math.PI));
          }

          // Drops pour down and out of the foot of the screen, each with a short tail.
          let leaving = 0;
          for (const drop of drops) {
            const q = (t - drop.leaves) / POUR_MS;
            if (q <= 0 || q >= 1.08) continue;
            const u = easeIn(clamp01(q));
            const at = path(u, drop.drift);
            for (let k = 1; k <= 5; k += 1) {
              const back = path(easeIn(clamp01(q - k * 0.035)), drop.drift);
              light(back.x, back.y, drop.size * (1 - k * 0.14), drop.strength * 0.3 * (1 - k / 6));
            }
            light(at.x, at.y, drop.size * 1.6, drop.strength * 0.85);
            core(at.x, at.y, Math.max(1, drop.size * 0.1), drop.strength);
            if (u > 0.82) leaving += drop.strength;
            if (drop.size > h * 0.05 && Math.random() < 0.8) {
              flying.push({ x: at.x, y: at.y, vx: (Math.random() - 0.5) * h * 0.1, vy: -h * Math.random() * 0.05, born: now, life: 450 + Math.random() * 400, size: 1 + Math.random() * 1.4 });
            }
          }
          // Where it leaves the screen, toward the visitor, the foot glows while the light passes.
          const passing = clamp01((t - GATHER_MS - POUR_MS * 0.6) / 300) * (1 - clamp01((t - end + 600) / 600));
          light(foot.x, height, h * 0.26, (0.2 + 0.5 * Math.min(1, leaving * 0.5)) * passing);

          sparks(flying, now, dt);
          return t < end || flying.length > 0;
        },
      });
    },

    clear() {
      const cleared = effects;
      effects = [];
      cleared.forEach((effect) => effect.cancel());
      cancelAnimationFrame(raf);
      raf = 0;
      if (context) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
      }
    },

    dispose() {
      this.clear();
      observer.disconnect();
    },
  };
}
