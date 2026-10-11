/**
 * The demo's photos, drawn as pixel scenes on a 64x48 grid instead of real
 * photos: the main gate in the morning, the stalls in the courtyard at noon,
 * the classroom building, and the deck by the canal at dusk.
 */

type Rect = readonly [x: number, y: number, width: number, height: number, fill: string];

export type DemoPhotoName = "gate" | "stalls" | "research" | "deck";

/** Horizontal bands from the top: [height, colour] pairs. */
function bands(...rows: [number, string][]): Rect[] {
  let y = 0;
  return rows.map(([height, fill]) => {
    const rect: Rect = [0, y, 64, height, fill];
    y += height;
    return rect;
  });
}

/** A grid of windows: `columns` x `rows`, each `width` x `height`, `gapX` and `gapY` apart. */
function windows(x: number, y: number, columns: number, rows: number, width: number, height: number, gapX: number, gapY: number, fill: string, lit?: { fill: string; every: number }): Rect[] {
  const rects: Rect[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      rects.push([x + column * (width + gapX), y + row * (height + gapY), width, height, lit && index % lit.every === 1 ? lit.fill : fill]);
    }
  }
  return rects;
}

/** Vertical stripes across a strip, alternating two colours. */
function stripes(x: number, y: number, width: number, height: number, step: number, a: string, b: string): Rect[] {
  const rects: Rect[] = [];
  for (let offset = 0; offset < width; offset += step) rects.push([x + offset, y, Math.min(step, width - offset), height, (offset / step) % 2 === 0 ? a : b]);
  return rects;
}

/** A round treetop on a trunk. */
function tree(x: number, y: number, leaf: string, light: string, trunk: string): Rect[] {
  return [
    [x + 3, y + 8, 2, 4, trunk],
    [x + 2, y, 4, 1, leaf],
    [x + 1, y + 1, 6, 1, leaf],
    [x, y + 2, 8, 5, leaf],
    [x + 1, y + 7, 6, 1, leaf],
    [x + 2, y + 1, 2, 1, light],
    [x + 1, y + 2, 2, 2, light],
  ];
}

/** A small person seen from a distance. */
function person(x: number, y: number, shirt: string): Rect[] {
  return [
    [x + 1, y, 2, 2, "#ffd0a6"],
    [x, y + 2, 4, 4, shirt],
    [x, y + 6, 1, 3, "#1b2150"],
    [x + 3, y + 6, 1, 3, "#1b2150"],
  ];
}

const SCENES: Record<DemoPhotoName, Rect[]> = {
  // The main gate, early: a pale sky, long shadows, the path in.
  gate: [
    ...bands([8, "#84b8ff"], [8, "#a6caff"], [8, "#cbdcf6"], [6, "#f4d9c0"], [18, "#9fc28a"]),
    [51, 5, 4, 1, "#fff1a8"],
    [50, 6, 6, 4, "#fff1a8"],
    [51, 10, 4, 1, "#fff1a8"],
    [0, 20, 9, 10, "#a7bde6"],
    [9, 16, 7, 14, "#a7bde6"],
    [42, 19, 11, 11, "#a7bde6"],
    [53, 23, 11, 7, "#a7bde6"],
    ...windows(11, 18, 2, 5, 1, 1, 2, 1, "#c9dcff"),
    ...windows(44, 21, 4, 3, 1, 1, 1, 2, "#c9dcff"),
    [0, 30, 64, 2, "#7fae6c"],
    [26, 32, 12, 2, "#e8dcc0"],
    [24, 34, 16, 3, "#e8dcc0"],
    [22, 37, 20, 4, "#e8dcc0"],
    [20, 41, 24, 3, "#e8dcc0"],
    [18, 44, 28, 4, "#e8dcc0"],
    [30, 33, 1, 15, "#d4c6a4"],
    [33, 33, 1, 15, "#d4c6a4"],
    ...tree(1, 20, "#2f9e5a", "#4ade80", "#7a4a2a"),
    ...tree(55, 20, "#2f9e5a", "#4ade80", "#7a4a2a"),
    [13, 15, 6, 22, "#8a8fa8"],
    [13, 15, 2, 22, "#a9adc2"],
    [12, 14, 8, 2, "#6b7090"],
    [45, 15, 6, 22, "#8a8fa8"],
    [45, 15, 2, 22, "#a9adc2"],
    [44, 14, 8, 2, "#6b7090"],
    [14, 21, 4, 7, "#fff7e6"],
    [15, 22, 2, 1, "#1b2150"],
    [15, 24, 2, 1, "#1b2150"],
    [15, 26, 2, 1, "#1b2150"],
    [19, 36, 9, 1, "#6f9460"],
    [51, 36, 10, 1, "#6f9460"],
  ],

  // The courtyard at noon: red and white tents under bunting.
  stalls: [
    ...bands([7, "#57a0ff"], [7, "#74b4ff"], [6, "#93c8ff"], [6, "#b6dcff"], [22, "#d8cfb8"]),
    [0, 6, 64, 20, "#8fb0e6"],
    ...windows(3, 8, 10, 3, 3, 2, 3, 3, "#3b5694", { fill: "#a8d4ff", every: 3 }),
    [0, 9, 8, 1, "#fff7e6"],
    [8, 10, 16, 1, "#fff7e6"],
    [24, 11, 16, 1, "#fff7e6"],
    [40, 12, 24, 1, "#fff7e6"],
    [2, 10, 2, 2, "#ff7a8a"],
    [3, 12, 1, 1, "#ff7a8a"],
    [12, 11, 2, 2, "#ffd23f"],
    [13, 13, 1, 1, "#ffd23f"],
    [22, 11, 2, 2, "#67e8f9"],
    [23, 13, 1, 1, "#67e8f9"],
    [32, 12, 2, 2, "#ff7a8a"],
    [33, 14, 1, 1, "#ff7a8a"],
    [42, 13, 2, 2, "#ffd23f"],
    [43, 15, 1, 1, "#ffd23f"],
    [52, 13, 2, 2, "#67e8f9"],
    [53, 15, 1, 1, "#67e8f9"],
    [60, 13, 2, 2, "#ff7a8a"],
    [61, 15, 1, 1, "#ff7a8a"],
    [6, 17, 36, 1, "#8a1a2e"],
    ...stripes(6, 18, 36, 6, 4, "#c0263f", "#fff7e6"),
    ...stripes(6, 24, 36, 2, 2, "#c0263f", "#fff7e6"),
    [7, 26, 1, 12, "#8a8fa8"],
    [40, 26, 1, 12, "#8a8fa8"],
    [8, 32, 32, 2, "#e8a317"],
    [8, 34, 32, 4, "#8a4f00"],
    [12, 29, 4, 3, "#ff7a8a"],
    [18, 30, 3, 2, "#ffd23f"],
    [30, 29, 5, 3, "#67e8f9"],
    ...person(23, 26, "#4ade80"),
    [45, 21, 18, 1, "#141838"],
    ...stripes(45, 22, 18, 5, 3, "#38418f", "#fff7e6"),
    [46, 27, 1, 11, "#8a8fa8"],
    [61, 27, 1, 11, "#8a8fa8"],
    [47, 33, 14, 5, "#8a4f00"],
    [47, 32, 14, 1, "#e8a317"],
    ...person(16, 37, "#67e8f9"),
    ...person(44, 38, "#ffd23f"),
    ...person(52, 39, "#ff7a8a"),
    [0, 40, 64, 1, "#c2b89e"],
    [0, 44, 64, 1, "#c2b89e"],
    [10, 38, 1, 10, "#c2b89e"],
    [30, 38, 1, 10, "#c2b89e"],
    [50, 38, 1, 10, "#c2b89e"],
  ],

  // The classroom building: rows of windows above the lawn.
  research: [
    ...bands([8, "#3d8bff"], [8, "#57a0ff"], [8, "#74b4ff"], [10, "#93c8ff"], [6, "#4f9e5a"], [8, "#cfc6b0"]),
    [3, 5, 8, 2, "#ffffff"],
    [1, 7, 12, 2, "#ffffff"],
    [4, 9, 6, 1, "#d6e6ff"],
    [50, 3, 6, 2, "#ffffff"],
    [48, 5, 11, 2, "#ffffff"],
    [12, 8, 42, 1, "#6b7090"],
    [12, 9, 42, 31, "#e6e9f5"],
    [12, 9, 5, 31, "#c3c8ec"],
    ...windows(19, 11, 6, 4, 4, 3, 2, 3, "#3b5694", { fill: "#a8d4ff", every: 4 }),
    [27, 32, 12, 8, "#2a3f7a"],
    [32, 32, 1, 8, "#e6e9f5"],
    [27, 31, 12, 1, "#6b7090"],
    [12, 39, 42, 1, "#8a8fa8"],
    ...tree(2, 28, "#2f9e5a", "#4ade80", "#7a4a2a"),
    ...tree(54, 28, "#2f9e5a", "#4ade80", "#7a4a2a"),
    [18, 37, 6, 3, "#2f9e5a"],
    [42, 37, 7, 3, "#2f9e5a"],
    [28, 40, 10, 8, "#e8dcc0"],
    ...person(44, 40, "#ff7a8a"),
  ],

  // The deck by the canal at dusk: the sun low over the far bank.
  deck: [
    ...bands([5, "#4f3a8f"], [5, "#7b3fa0"], [5, "#c04f8a"], [4, "#ec6f6f"], [4, "#ff9a5a"], [3, "#ffc46e"], [22, "#3b3a8a"]),
    [38, 18, 8, 1, "#ffe08a"],
    [37, 19, 10, 4, "#ffe08a"],
    [36, 23, 12, 3, "#ffe08a"],
    [0, 17, 7, 9, "#3a2f6e"],
    [7, 13, 6, 13, "#3a2f6e"],
    [13, 19, 9, 7, "#3a2f6e"],
    [24, 15, 8, 11, "#3a2f6e"],
    [50, 16, 6, 10, "#3a2f6e"],
    [56, 20, 8, 6, "#3a2f6e"],
    ...windows(8, 15, 2, 4, 1, 1, 2, 2, "#2a2458", { fill: "#ffd23f", every: 2 }),
    ...windows(25, 17, 3, 3, 1, 1, 1, 2, "#2a2458", { fill: "#ffd23f", every: 3 }),
    ...windows(51, 18, 2, 3, 1, 1, 2, 2, "#2a2458", { fill: "#ffd23f", every: 2 }),
    [0, 26, 64, 1, "#231c4f"],
    [38, 28, 8, 1, "#ffc46e"],
    [36, 30, 12, 1, "#ff9a5a"],
    [39, 32, 6, 1, "#ffc46e"],
    [8, 29, 4, 1, "#ff9a5a"],
    [20, 31, 5, 1, "#c04f8a"],
    [52, 29, 5, 1, "#ff9a5a"],
    [56, 33, 4, 1, "#c04f8a"],
    [0, 34, 64, 1, "#231c4f"],
    [0, 35, 64, 1, "#3a2f6e"],
    [2, 35, 1, 6, "#231c4f"],
    [14, 35, 1, 6, "#231c4f"],
    [26, 35, 1, 6, "#231c4f"],
    [38, 35, 1, 6, "#231c4f"],
    [50, 35, 1, 6, "#231c4f"],
    [62, 35, 1, 6, "#231c4f"],
    [0, 38, 64, 1, "#231c4f"],
    [44, 28, 4, 3, "#231c4f"],
    [45, 26, 2, 2, "#231c4f"],
    [44, 31, 1, 7, "#231c4f"],
    [47, 31, 1, 7, "#231c4f"],
    [0, 41, 64, 7, "#8a4f00"],
    [0, 41, 64, 1, "#e8a317"],
    [0, 44, 64, 1, "#6b3c00"],
    [0, 47, 64, 1, "#6b3c00"],
    [9, 42, 1, 2, "#6b3c00"],
    [27, 45, 1, 2, "#6b3c00"],
    [41, 42, 1, 2, "#6b3c00"],
    [57, 45, 1, 2, "#6b3c00"],
  ],
};

export const DEMO_PHOTO_LABEL: Record<DemoPhotoName, string> = {
  gate: "朝の正門",
  stalls: "中庭の模擬店",
  research: "研究棟",
  deck: "夕方の運河沿いのデッキ",
};

/** One demo photo. Give `label` where it stands for a photo; leave it out where the text beside it says the same. */
export function PixelPhoto({ name, className, label }: { name: DemoPhotoName; className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 64 48"
      shapeRendering="crispEdges"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {SCENES[name].map(([x, y, width, height, fill], index) => (
        <rect key={index} x={x} y={y} width={width} height={height} fill={fill} />
      ))}
    </svg>
  );
}
