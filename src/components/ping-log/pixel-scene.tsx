import { memo } from "react";

import { PixelSprite } from "./pixel-sprite";

/**
 * The world behind the windows: a sky that follows the clock, drifting
 * clouds, the sun or the moon, and a waterside skyline like the one around
 * the Toyosu campus, with windows that light up after dark. Everything is
 * drawn from a fixed seed, so it is the same on every render.
 */

export type Phase = "morning" | "day" | "dusk" | "night";

export function phaseAt(time: number): Phase {
  const date = new Date(time);
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes >= 5 * 60 && minutes < 9 * 60) return "morning";
  if (minutes >= 9 * 60 && minutes < 16 * 60) return "day";
  if (minutes >= 16 * 60 && minutes < 17 * 60 + 30) return "dusk";
  return "night";
}

/** Screen pixels per picture pixel. */
const U = 3;
/** One tile of the skyline, in picture pixels; it repeats across the screen. */
const TILE = { width: 160, height: 64 };
const WATER = 12;
const QUAY = 2;
const GROUND = TILE.height - WATER - QUAY;

/** mulberry32: a tiny deterministic generator. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Box = { x: number; y: number; width: number; height: number; tone: string };

const BACK: [number, number, number][] = [
  [0, 10, 26], [9, 8, 38], [22, 14, 30], [40, 6, 46], [52, 16, 34], [74, 10, 40], [90, 18, 28], [112, 8, 44], [124, 14, 32], [142, 10, 38], [152, 8, 24],
];
const FRONT: [number, number, number][] = [
  [2, 12, 18], [16, 10, 26], [30, 20, 14], [52, 12, 30], [66, 24, 22], [92, 10, 16], [104, 14, 34], [120, 16, 20], [138, 10, 26], [150, 10, 14],
];

const CITY: Box[] = (() => {
  const random = generator(1954);
  const boxes: Box[] = [];
  for (const [x, width, height] of BACK) boxes.push({ x, y: GROUND - height, width, height, tone: "c-back" });
  for (const [x, width, height] of FRONT) {
    const top = GROUND - height;
    boxes.push({ x, y: top, width, height, tone: "c-front" });
    for (let row = top + 2; row < GROUND - 2; row += 3) {
      for (let column = x + 2; column < x + width - 1; column += 2) {
        boxes.push({ x: column, y: row, width: 1, height: 1, tone: random() < 0.38 ? "c-lit" : "c-window" });
      }
    }
  }
  // An antenna on the second tower.
  boxes.push({ x: 21, y: GROUND - 26 - 5, width: 1, height: 5, tone: "c-front" });
  boxes.push({ x: 0, y: GROUND, width: TILE.width, height: QUAY, tone: "c-quay" });
  boxes.push({ x: 0, y: GROUND + QUAY, width: TILE.width, height: WATER, tone: "c-water" });
  return boxes;
})();

function glints(seed: number): Box[] {
  const random = generator(seed);
  return Array.from({ length: 16 }, () => ({
    x: Math.floor(random() * (TILE.width - 6)),
    y: GROUND + QUAY + 2 + Math.floor(random() * (WATER - 3)),
    width: 2 + Math.floor(random() * 4),
    height: 1,
    tone: "c-glint",
  }));
}

const GLINTS_A = glints(7);
const GLINTS_B = glints(11);

type Star = { left: number; top: number; size: number; gold: boolean; duration: number; delay: number };

const STARS: Star[] = (() => {
  const random = generator(54);
  return Array.from({ length: 40 }, (_, index) => ({
    left: random() * 100,
    top: random() * 62,
    size: random() < 0.25 ? 6 : 3,
    gold: index % 5 === 0,
    duration: 2 + random() * 2.5,
    delay: -random() * 4,
  }));
})();

const CLOUDS = [
  { top: "9%", scale: 3, drift: 150, delay: -30 },
  { top: "24%", scale: 2, drift: 110, delay: -80 },
  { top: "4%", scale: 2, drift: 190, delay: -150 },
];

function Tile({ id, boxes, className }: { id: string; boxes: Box[]; className: string }) {
  return (
    <svg className={className} width="100%" height={TILE.height * U} shapeRendering="crispEdges" aria-hidden="true">
      <defs>
        <pattern id={id} width={TILE.width * U} height={TILE.height * U} patternUnits="userSpaceOnUse">
          <g transform={`scale(${U})`}>
            {boxes.map((box, index) => <rect key={index} className={box.tone} x={box.x} y={box.y} width={box.width} height={box.height} />)}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** Redrawn only when the time of day changes, not on every tick of the page's clock. */
export const PixelScene = memo(function PixelScene({ phase }: { phase: Phase }) {
  const stars = phase === "night" ? STARS : phase === "dusk" ? STARS.filter((star) => star.top < 22) : [];
  return (
    <div className="px-scene" data-phase={phase} aria-hidden="true">
      {stars.map((star, index) => (
        <span
          key={index}
          className={`px-scene__star ${star.gold ? "px-scene__star--gold" : ""}`}
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: star.size,
            height: star.size,
            ["--d" as string]: `${star.duration.toFixed(2)}s`,
            ["--delay" as string]: `${star.delay.toFixed(2)}s`,
          }}
        />
      ))}
      {phase === "night" ? (
        <span className="px-scene__orb" style={{ right: "14%", top: 72 }}>
          <PixelSprite name="moon" scale={5} />
        </span>
      ) : (
        <span
          className="px-scene__orb px-scene__orb--sun"
          style={
            phase === "dusk"
              ? { left: "18%", bottom: 150, ["--sun" as string]: "#ffb36b" }
              : phase === "morning"
                ? { left: "12%", top: "20%" }
                : { right: "14%", top: 76 }
          }
        >
          <PixelSprite name="sun" scale={phase === "dusk" ? 7 : 5} />
        </span>
      )}
      {CLOUDS.map((cloud, index) => (
        <span
          key={index}
          className="px-scene__cloud"
          style={{ top: cloud.top, ["--drift" as string]: `${cloud.drift}s`, ["--delay" as string]: `${cloud.delay}s` }}
        >
          <PixelSprite name="cloud" scale={cloud.scale} />
        </span>
      ))}
      <Tile id="px-city" boxes={CITY} className="px-scene__city" />
      <Tile id="px-glint-a" boxes={GLINTS_A} className="px-scene__glints" />
      <Tile id="px-glint-b" boxes={GLINTS_B} className="px-scene__glints px-scene__glints--b" />
    </div>
  );
});
