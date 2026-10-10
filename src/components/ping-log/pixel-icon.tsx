/**
 * 12x12 pixel-art icons, drawn as crisp SVG rectangles so they stay sharp at
 * any size and take the text colour.
 */

const ICONS = {
  bell: [
    ".....##.....",
    "....####....",
    "...######...",
    "..########..",
    "..########..",
    "..########..",
    "..########..",
    ".##########.",
    "############",
    "............",
    "....####....",
    ".....##.....",
  ],
  pin: [
    "............",
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
    "............",
  ],
  stairs: [
    "............",
    "............",
    ".........###",
    ".........###",
    "......######",
    "......######",
    "...#########",
    "...#########",
    "############",
    "############",
    "............",
    "............",
  ],
  camera: [
    "............",
    "....####....",
    ".##########.",
    "############",
    "#####..#####",
    "####....####",
    "####....####",
    "#####..#####",
    "############",
    ".##########.",
    "............",
    "............",
  ],
  check: [
    "............",
    "..........##",
    ".........###",
    "........###.",
    "##.....###..",
    "###...###...",
    ".###.###....",
    "..#####.....",
    "...###......",
    "....#.......",
    "............",
    "............",
  ],
  cross: [
    "............",
    ".##......##.",
    ".###....###.",
    "..###..###..",
    "...######...",
    "....####....",
    "....####....",
    "...######...",
    "..###..###..",
    ".###....###.",
    ".##......##.",
    "............",
  ],
  arrow: [
    "............",
    ".....##.....",
    ".....###....",
    ".....####...",
    "###########.",
    "############",
    "###########.",
    ".....####...",
    ".....###....",
    ".....##.....",
    "............",
    "............",
  ],
  clock: [
    "...######...",
    "..#......#..",
    ".#...##...#.",
    "#....##....#",
    "#....##....#",
    "#....####..#",
    "#..........#",
    ".#........#.",
    "..#......#..",
    "...######...",
    "............",
    "............",
  ],
  share: [
    ".....##.....",
    "....####....",
    "...######...",
    ".....##.....",
    ".....##.....",
    ".##..##..##.",
    ".##..##..##.",
    ".##......##.",
    ".##......##.",
    ".##########.",
    ".##########.",
    "............",
  ],
  add: [
    ".##########.",
    ".#........#.",
    ".#...##...#.",
    ".#...##...#.",
    ".#.######.#.",
    ".#.######.#.",
    ".#...##...#.",
    ".#...##...#.",
    ".#........#.",
    ".##########.",
    "............",
    "............",
  ],
} as const;

export type PixelIconName = keyof typeof ICONS;

/** Each run of filled pixels in a row becomes one rectangle. */
const RUNS: Record<PixelIconName, { x: number; y: number; width: number }[]> = Object.fromEntries(
  (Object.keys(ICONS) as PixelIconName[]).map((name) => {
    const runs: { x: number; y: number; width: number }[] = [];
    ICONS[name].forEach((row, y) => {
      let start = -1;
      for (let x = 0; x <= row.length; x += 1) {
        const filled = row[x] === "#";
        if (filled && start < 0) start = x;
        if (!filled && start >= 0) {
          runs.push({ x: start, y, width: x - start });
          start = -1;
        }
      }
    });
    return [name, runs];
  }),
) as Record<PixelIconName, { x: number; y: number; width: number }[]>;

type Props = {
  name: PixelIconName;
  size?: number;
  className?: string;
  /** Give one when the icon carries meaning the text beside it does not. */
  label?: string;
};

export function PixelIcon({ name, size = 20, className, label }: Props) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      fill="currentColor"
      className={`shrink-0 ${className ?? ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {RUNS[name].map((run) => <rect key={`${run.x}-${run.y}`} x={run.x} y={run.y} width={run.width} height={1} />)}
    </svg>
  );
}
