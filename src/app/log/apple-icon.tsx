import { ImageResponse } from "next/og";

/**
 * The home-screen icon: the pixel pin from the page, pink on the festival's
 * dark panel inside a teal frame. On an iPhone this is what people tap to get
 * back to the page, so it should look like the page.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";
// Drawn once at build time, which the static export (NEXT_STATIC_EXPORT=1) requires.
export const dynamic = "force-static";

const PIN = [
  "...######...",
  "..########..",
  ".####..####.",
  ".###....###.",
  ".###....###.",
  ".####..####.",
  "..########..",
  "...######...",
  "....####....",
  ".....##.....",
];
const CELL = 10;

export default function AppleIcon() {
  const cells: { x: number; y: number }[] = [];
  PIN.forEach((row, y) => [...row].forEach((value, x) => value === "#" && cells.push({ x, y })));
  const left = (size.width - PIN[0].length * CELL) / 2;
  const top = (size.height - PIN.length * CELL) / 2 + 4;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#6fe3d9", padding: 12 }}>
        <div style={{ position: "relative", display: "flex", width: "100%", height: "100%", background: "#111018" }}>
          {cells.map((cell) => (
            <div
              key={`${cell.x}-${cell.y}`}
              style={{ position: "absolute", left: left - 12 + cell.x * CELL, top: top - 12 + cell.y * CELL, width: CELL, height: CELL, background: "#ec1e8f" }}
            />
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
