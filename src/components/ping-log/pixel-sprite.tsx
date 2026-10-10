/**
 * Multi-colour pixel art: the map pin, the coin, clouds and the sun and moon.
 * Each letter is a colour from the theme; "." is clear. Runs of one colour in
 * a row are merged, and each colour becomes a single path.
 */

const COLOURS: Record<string, string> = {
  K: "var(--px-k)",
  N: "var(--px-navy)",
  Y: "var(--px-yellow)",
  H: "var(--px-yellow-hi)",
  O: "var(--px-yellow-lo)",
  W: "var(--cloud, #fff)",
  S: "var(--cloud-shade, #d6e6ff)",
  M: "#fff1c9",
  m: "#e4d29a",
  U: "var(--sun, #fff1a8)",
};

const SPRITES = {
  pin: [
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
  ],
  coin: [
    "....KKKK....",
    "..KKYYYYKK..",
    ".KYHHYYYYYK.",
    ".KHYYOOYYOK.",
    "KYHYYOYYYYOK",
    "KYHYYOYYYYOK",
    "KYYYYOYYYYOK",
    "KYYYYOYYYYOK",
    ".KYYYOOYYOK.",
    ".KYYYYYYOOK.",
    "..KKOOOOKK..",
    "....KKKK....",
  ],
  cloud: [
    "..........WWWW..............",
    "........WWWWWWWW...WWW......",
    "......WWWWWWWWWWWWWWWWWW....",
    "...WWWWWWWWWWWWWWWWWWWWWWW..",
    "..WWWWWWWWWWWWWWWWWWWWWWWWW.",
    ".WWWWWWWWWWWWWWWWWWWWWWWWWWW",
    "SSSSSSSSSSSSSSSSSSSSSSSSSSSS",
    "..SSSSSSSSSSSSSSSSSSSSSSSS..",
  ],
  moon: [
    "...MMMM...",
    ".MMMMMMMM.",
    ".MMmMMMMM.",
    "MMMMMMMmMM",
    "MMMMMMMMMM",
    "MMmMMMMMMM",
    "MMMMMMMMMM",
    ".MMMMMmMM.",
    ".MMMMMMMM.",
    "...MMMM...",
  ],
  sun: [
    "...UUUU...",
    ".UUUUUUUU.",
    ".UUUUUUUU.",
    "UUUUUUUUUU",
    "UUUUUUUUUU",
    "UUUUUUUUUU",
    "UUUUUUUUUU",
    ".UUUUUUUU.",
    ".UUUUUUUU.",
    "...UUUU...",
  ],
} as const;

export type SpriteName = keyof typeof SPRITES;

type Compiled = { width: number; height: number; paths: { fill: string; d: string }[] };

function compile(rows: readonly string[]): Compiled {
  const byColour = new Map<string, string[]>();
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const letter = row[x];
      if (letter === ".") {
        x += 1;
        continue;
      }
      let end = x;
      while (end < row.length && row[end] === letter) end += 1;
      const parts = byColour.get(letter) ?? [];
      parts.push(`M${x} ${y}h${end - x}v1h${x - end}z`);
      byColour.set(letter, parts);
      x = end;
    }
  });
  return {
    width: rows[0].length,
    height: rows.length,
    paths: [...byColour].map(([letter, parts]) => ({ fill: COLOURS[letter], d: parts.join("") })),
  };
}

const COMPILED = Object.fromEntries(Object.entries(SPRITES).map(([name, rows]) => [name, compile(rows)])) as Record<SpriteName, Compiled>;

/** The pin as markup, for places that take an HTML string (Leaflet's marker icon). */
export function spriteMarkup(name: SpriteName, scale: number): string {
  const { width, height, paths } = COMPILED[name];
  const fills: Record<string, string> = { "var(--px-k)": "#0b0d1f", "var(--px-navy)": "#1b2150", "var(--px-yellow)": "#ffd23f", "var(--px-yellow-hi)": "#fff1a8", "var(--px-yellow-lo)": "#e8a317" };
  const body = paths.map((path) => `<path fill="${fills[path.fill] ?? path.fill}" d="${path.d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * scale}" height="${height * scale}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${body}</svg>`;
}

export function spriteSize(name: SpriteName): { width: number; height: number } {
  return { width: COMPILED[name].width, height: COMPILED[name].height };
}

type Props = {
  name: SpriteName;
  /** Screen pixels per picture pixel; whole numbers keep the edges sharp. */
  scale?: number;
  className?: string;
  label?: string;
};

export function PixelSprite({ name, scale = 3, className, label }: Props) {
  const { width, height, paths } = COMPILED[name];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width * scale}
      height={height * scale}
      shapeRendering="crispEdges"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {paths.map((path) => <path key={path.fill} d={path.d} style={{ fill: path.fill }} />)}
    </svg>
  );
}
