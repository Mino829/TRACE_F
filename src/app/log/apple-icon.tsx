import { ImageResponse } from "next/og";

/**
 * The home-screen icon: the page's yellow pixel pin on the night-blue ground,
 * with a few stars. On an iPhone this is what people tap to get back to the
 * page, so it should look like the page.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
// Drawn once at build time, which the static export (NEXT_STATIC_EXPORT=1) requires.
export const dynamic = "force-static";

/** The same picture as the pin in pixel-sprite.tsx. */
const PIN = [
  "....KKKK....",
  "..KKYYYYKK..",
  ".KYYHHYYYYK.",
  ".KYHYYYYYYK.",
  "KYYYYKKYYYYK",
  "KYYYKNNKYYYK",
  "KYYYKNNKYYYK",
  "KYYYYKKYYYOK",
  ".KYYYYYYYOK.",
  ".KOYYYYYYOK.",
  "..KOYYYYOK..",
  "...KOYYOK...",
  "....KOOK....",
  ".....KK.....",
];
const COLOURS: Record<string, string> = { K: "#0b0d1f", N: "#1b2150", Y: "#ffd23f", H: "#fff1a8", O: "#e8a317" };
const CELL = 9;
const STARS = [
  { x: 22, y: 28, size: 6 },
  { x: 146, y: 22, size: 9 },
  { x: 156, y: 116, size: 6 },
  { x: 18, y: 132, size: 6 },
];

export default function AppleIcon() {
  const cells: { x: number; y: number; colour: string }[] = [];
  PIN.forEach((row, y) => [...row].forEach((value, x) => value !== "." && cells.push({ x, y, colour: COLOURS[value] })));
  const left = (size.width - PIN[0].length * CELL) / 2;
  const top = (size.height - PIN.length * CELL) / 2;

  return new ImageResponse(
    (
      <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: "#1b2150" }}>
        {STARS.map((star) => (
          <div key={`${star.x}-${star.y}`} style={{ position: "absolute", left: star.x, top: star.y, width: star.size, height: star.size, background: "#fff7e6" }} />
        ))}
        {cells.map((cell) => (
          <div
            key={`${cell.x}-${cell.y}`}
            style={{ position: "absolute", left: left + cell.x * CELL, top: top + cell.y * CELL, width: CELL, height: CELL, background: cell.colour }}
          />
        ))}
      </div>
    ),
    { ...size },
  );
}
