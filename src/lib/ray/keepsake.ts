/**
 * The keepsake (作品, #14): the photos a participant took before arriving at
 * ShibaLab, in the order taken, on one image the shape of a phone's screen
 * (9:16, which a story takes as it is). Above them, where their places are
 * known, the way between them as 振り返り3D draws it (trace-scene.ts).
 *
 * Drawn on a canvas in the room's ink and handed back as a JPEG, which
 * carries no metadata: no place, no time stamp, no phone.
 */

export type KeepsakePhoto = { blob: Blob; takenAt: string; number: number; place: { checkpointId: string; graphVersion: string } | null };

/** Laid out in units of a 1080 × 1920 page, drawn at 4/3 of that: 1440 × 2560 px. */
const W = 1080;
const H = 1920;
const SCALE = 4 / 3;
const MARGIN = 72;

/** The room's colours (stage.tsx). */
const PAPER = "#d3d5d3";
const INK = "#0c0c0d";
const DIM = "#a2a4a7";

/** Between photos across and down, and the caption's band under each. */
const GAP_X = 36;
const GAP_Y = 40;
const CAPTION = 46;

/** The photos' area, and the way's band at its top: lower as there are more photos, so they stay large enough. */
const AREA = { x: MARGIN, y: 446, w: W - MARGIN * 2, h: 1262 };
const bandFor = (count: number) => (count > 6 ? 300 : count > 3 ? 360 : 420);

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

type Box = { x: number; y: number; w: number; h: number };
type Fonts = { latin: string; mono: string };

const pad = (value: number) => String(value).padStart(2, "0");
const clockOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** A photo of this width over height, as large as fits the box. */
function fit(ratio: number, width: number, height: number): { w: number; h: number } {
  return ratio > width / height ? { w: width, h: width / ratio } : { w: height * ratio, h: height };
}

/**
 * Where each photo goes: rows read left to right, top to bottom. The column
 * count is the one that shows the photos largest; a row's photos stand on
 * one caption line, and the rows sit in the middle of the area.
 */
export function arrange(ratios: number[], area: Box): Box[] {
  const n = ratios.length;
  const sizeFor = (cols: number) => {
    const rows = Math.ceil(n / cols);
    const cellW = (area.w - (cols - 1) * GAP_X) / cols;
    // Too many rows for the area leave no room at all, never a negative height that fit() would turn into a huge photo.
    const cellH = Math.max(0, (area.h - (rows - 1) * GAP_Y) / rows - CAPTION);
    return { rows, cellW, sizes: ratios.map((ratio) => fit(ratio, cellW, cellH)) };
  };
  let cols = 1;
  let best = -1;
  for (let count = 1; count <= Math.min(4, n); count += 1) {
    const shown = sizeFor(count).sizes.reduce((sum, size) => sum + size.w * size.h, 0);
    // Another column has to show the photos clearly larger: fewer, larger photos read better.
    if (shown > best * 1.04) {
      best = shown;
      cols = count;
    }
  }
  const { rows, cellW, sizes } = sizeFor(cols);
  const bands = Array.from({ length: rows }, (_, row) => Math.max(...sizes.slice(row * cols, (row + 1) * cols).map((size) => size.h)));
  const total = bands.reduce((sum, band) => sum + band + CAPTION, 0) + (rows - 1) * GAP_Y;
  let top = area.y + (area.h - total) / 2;
  const boxes: Box[] = [];
  bands.forEach((band, row) => {
    for (let index = row * cols; index < Math.min(n, (row + 1) * cols); index += 1) {
      const col = index - row * cols;
      const { w, h } = sizes[index];
      boxes.push({ x: area.x + col * (cellW + GAP_X) + (cellW - w) / 2, y: top + band - h, w, h });
    }
    top += band + CAPTION + GAP_Y;
  });
  return boxes;
}

/** Text with its own letter spacing (in em), which canvas draws only in newer browsers. */
function spaced(context: CanvasRenderingContext2D, text: string, x: number, y: number, em: number, align: "left" | "right" = "left") {
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(context.font)?.[1] ?? "16");
  const gap = size * em;
  const chars = [...text];
  const width = chars.reduce((sum, char) => sum + context.measureText(char).width, 0) + gap * (chars.length - 1);
  let at = align === "right" ? x - width : x;
  context.textAlign = "left";
  for (const char of chars) {
    context.fillText(char, at, y);
    at += context.measureText(char).width + gap;
  }
  return { left: align === "right" ? x - width : x, width };
}

type Point = { x: number; y: number };
type Way = { image: HTMLCanvasElement; marks: (Point & { text: string })[]; path: Point[]; end: Point | null };

/**
 * The way through the photos' places as a picture `width` × `height` px, and
 * where each place's photo numbers go on it, the way's line and ShibaLab, all
 * in the picture's px; null when no place is known or there is no WebGL. The
 * graph comes with trace-scene.ts, already loaded by the 3D above the
 * keepsake on the screen.
 */
async function wayFor(photos: KeepsakePhoto[], width: number, height: number, pad: { x: number; y: number }): Promise<Way | null> {
  const [{ traceStill, traceWay }, { PLACES }] = await Promise.all([import("./trace-scene"), import("@/lib/places/places")]);
  const way = traceWay(photos.map((photo) => ({ checkpointId: photo.place?.checkpointId ?? "", graphVersion: photo.place?.graphVersion ?? "" })));
  if (!way.stops.some((stop) => stop !== null)) return null;
  const still = traceStill(PLACES, way, width, height, [211 / 255, 213 / 255, 211 / 255], pad);
  // Photos taken at one place share its numbers: "1・3".
  const byPlace = new Map<string, { x: number; y: number; numbers: number[] }>();
  way.stops.forEach((stop, index) => {
    const at = stop && still.project(stop);
    if (!stop || !at) return;
    const key = stop.join();
    const known = byPlace.get(key) ?? { ...at, numbers: [] };
    known.numbers.push(photos[index].number);
    byPlace.set(key, known);
  });
  return {
    image: still.image,
    marks: [...byPlace.values()].map(({ x, y, numbers }) => ({ x, y, text: numbers.join("・") })),
    path: way.points.map((point) => still.project(point)).filter((at): at is Point => at !== null),
    end: still.project(way.end),
  };
}

/** How far a point is from a box (0 inside it). */
const distanceTo = (box: Box, p: Point) => Math.hypot(Math.max(box.x - p.x, 0, p.x - box.x - box.w), Math.max(box.y - p.y, 0, p.y - box.y - box.h));

/**
 * Where each place's numbers are written, in page units: of eight places
 * round its dot, the one furthest from the way's line, ShibaLab's ring, the
 * other dots and the numbers already placed, inside the band. Earlier in
 * the list wins a tie, so most sit up and to the right as before.
 */
function placeMarks(context: CanvasRenderingContext2D, way: Way, band: Box): { text: string; x: number; y: number }[] {
  const at = (p: Point): Point => ({ x: band.x + p.x / SCALE, y: band.y + p.y / SCALE });
  // The line every few units, so a box's distance from it is the nearest of these.
  const line: Point[] = [];
  way.path.map(at).forEach((p, index, all) => {
    const q = all[index + 1];
    if (!q) return line.push(p);
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 4));
    for (let step = 0; step < steps; step++) line.push({ x: p.x + ((q.x - p.x) * step) / steps, y: p.y + ((q.y - p.y) * step) / steps });
  });
  const end = way.end && at(way.end);
  const dots = way.marks.map(at);
  // Half the line's glow, the ring's radius, a dot's (STILL in trace-scene.ts, over SCALE).
  const [LINE, RING, DOT] = [8, 22, 9];
  const TALL = 18;
  const inside = { x: band.x + 6, y: band.y + 6, w: band.w - 12, h: band.h - 12 };
  const placed: Box[] = [];
  return way.marks.map((mark, index) => {
    const { x, y } = dots[index];
    // As spaced() sets it: 0.1em between the figures.
    const wide = context.measureText(mark.text).width + 24 * 0.1 * ([...mark.text].length - 1);
    // Left edge and baseline of each place round the dot, up and to the right first.
    const spots: [number, number][] = [
      [x + 12, y - 12],
      [x + 16, y + TALL / 2],
      [x + 12, y + 12 + TALL],
      [x - 12 - wide, y - 12],
      [x - 16 - wide, y + TALL / 2],
      [x - 12 - wide, y + 12 + TALL],
      [x - wide / 2, y - 16],
      [x - wide / 2, y + 16 + TALL],
    ];
    let best = { left: spots[0][0], base: spots[0][1], box: { x: 0, y: 0, w: 0, h: 0 }, score: -Infinity };
    for (const [left, base] of spots) {
      // A little room round the figures is part of the box.
      const box = { x: left - 4, y: base - TALL - 4, w: wide + 8, h: TALL + 8 };
      const out = Math.max(inside.x - box.x, box.x + box.w - inside.x - inside.w, inside.y - box.y, box.y + box.h - inside.y - inside.h, 0);
      const clear = Math.min(
        24,
        ...line.map((p) => distanceTo(box, p) - LINE),
        end ? distanceTo(box, end) - RING : Infinity,
        ...dots.filter((_, other) => other !== index).map((p) => distanceTo(box, p) - DOT),
        ...placed.map((other) => Math.max(other.x - box.x - box.w, box.x - other.x - other.w, other.y - box.y - box.h, box.y - other.y - other.h)),
      );
      const score = clear - out * 10;
      if (score > best.score) best = { left, base, box, score };
    }
    placed.push(best.box);
    return { text: mark.text, x: best.left, y: best.base };
  });
}

/** The page's fonts, as the screen has them (--latin, --mono under .ray), loaded for the canvas. */
async function fontsFor(root: Element, sample: string): Promise<Fonts> {
  const style = getComputedStyle(root);
  const fonts = {
    latin: style.getPropertyValue("--latin").trim() || "Helvetica, Arial, sans-serif",
    mono: style.getPropertyValue("--mono").trim() || "ui-monospace, monospace",
  };
  // A font that does not load leaves the next one in the list: the picture is drawn either way.
  await Promise.all([
    document.fonts.load(`800 54px ${fonts.latin}`, "TRACE0123456789."),
    document.fonts.load(`500 24px ${fonts.mono}`, sample),
  ]).catch(() => undefined);
  return fonts;
}

/**
 * Draws the keepsake. `root` is an element under .ray, whose fonts the
 * picture uses. Resolves to a JPEG of 1440 × 2560 px.
 */
export async function drawKeepsake(photos: KeepsakePhoto[], root: Element): Promise<Blob> {
  if (!photos.length) throw new Error("作品にする写真がありません。");
  const bitmaps = await Promise.all(photos.map((photo) => createImageBitmap(photo.blob)));
  try {
    const first = new Date(photos[0].takenAt);
    const last = new Date(photos[photos.length - 1].takenAt);
    const date = `${first.getMonth() + 1}.${pad(first.getDate())}`;
    const span = photos.length > 1 ? `${clockOf(first)} → ${clockOf(last)}` : clockOf(first);
    const captions = photos.map((photo) => [`${photo.number}枚目`, clockOf(new Date(photo.takenAt))] as const);
    const fonts = await fontsFor(root, `ShibaLab 301 → ・ ${span} ${photos.length}枚 ${captions.flat().join(" ")} 54TH SHIBAURA FESTIVAL END OF LOG`);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * SCALE);
    canvas.height = Math.round(H * SCALE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("作品を描けませんでした。");
    context.scale(SCALE, SCALE);
    context.textBaseline = "alphabetic";

    // The room: ink, with the soft light of the screen at the back.
    context.fillStyle = INK;
    context.fillRect(0, 0, W, H);
    const light = context.createRadialGradient(W * 0.72, H * 0.36, 0, W * 0.72, H * 0.36, W);
    light.addColorStop(0, "rgba(211, 213, 211, 0.07)");
    light.addColorStop(1, "rgba(211, 213, 211, 0)");
    context.fillStyle = light;
    context.fillRect(0, 0, W, H);

    // The head: the wordmark and the room, a rule, then the day large and its hours beside it.
    context.fillStyle = PAPER;
    context.font = `800 54px ${fonts.latin}`;
    spaced(context, "TRACE", MARGIN, 128, -0.045);
    context.fillStyle = DIM;
    context.font = `500 24px ${fonts.mono}`;
    spaced(context, "ShibaLab 301", W - MARGIN, 124, 0.14, "right");
    context.fillStyle = PAPER;
    context.fillRect(MARGIN, 154, W - MARGIN * 2, 3);
    context.font = `800 232px ${fonts.latin}`;
    spaced(context, date, MARGIN - 10, 382, -0.06);
    context.fillStyle = DIM;
    context.font = `500 24px ${fonts.mono}`;
    spaced(context, `${first.getFullYear()} ${WEEKDAYS[first.getDay()]}`, W - MARGIN, 302, 0.14, "right");
    spaced(context, span, W - MARGIN, 338, 0.14, "right");
    spaced(context, `${photos.length}枚`, W - MARGIN, 374, 0.14, "right");

    // The way first, in a band across the top of the photos' area, its caption under it as a photo's is.
    const band = bandFor(photos.length);
    // Room at the sides for the numbers, which stand beside their dots.
    const way = await wayFor(photos, Math.round(AREA.w * SCALE), Math.round(band * SCALE), { x: 80 * SCALE, y: 44 * SCALE }).catch(() => null);
    if (way) {
      context.drawImage(way.image, AREA.x, AREA.y, AREA.w, band);
      context.strokeStyle = PAPER;
      context.lineWidth = 2;
      context.strokeRect(AREA.x + 1, AREA.y + 1, AREA.w - 2, band - 2);
      // The numbers as the captions under the photos are set, standing clear of the lines.
      context.font = `500 24px ${fonts.mono}`;
      context.fillStyle = PAPER;
      for (const mark of placeMarks(context, way, { x: AREA.x, y: AREA.y, w: AREA.w, h: band })) spaced(context, mark.text, mark.x, mark.y, 0.1);
      spaced(context, "TRACE", AREA.x + 2, AREA.y + band + 34, 0.1);
      spaced(context, "→ ShibaLab 301", AREA.x + AREA.w - 2, AREA.y + band + 34, 0.1, "right");
    }
    const photoTop = way ? AREA.y + band + CAPTION + GAP_Y : AREA.y;

    // The photos in their own colours, each in a hairline frame.
    const boxes = arrange(
      bitmaps.map((bitmap) => bitmap.width / bitmap.height),
      { x: AREA.x, y: photoTop, w: AREA.w, h: AREA.y + AREA.h - photoTop },
    );
    bitmaps.forEach((bitmap, index) => {
      const box = boxes[index];
      context.drawImage(bitmap, box.x, box.y, box.w, box.h);
      context.strokeStyle = PAPER;
      context.lineWidth = 2;
      context.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
    });

    // Each photo's frame number and time under it.
    context.font = `500 24px ${fonts.mono}`;
    context.fillStyle = PAPER;
    boxes.forEach((box, index) => {
      const [frame, time] = captions[index];
      const y = box.y + box.h + 34;
      // Under a narrow photo the two would run into each other: they go together, centred, a little past its edges.
      const line = `${frame} ${time}`;
      const width = [...line].reduce((sum, char) => sum + context.measureText(char).width, 0) + 24 * 0.1 * (line.length - 1);
      if (width + 16 > box.w) {
        spaced(context, line, box.x + (box.w - width) / 2, y, 0.1);
        return;
      }
      spaced(context, frame, box.x + 2, y, 0.1);
      spaced(context, time, box.x + box.w - 2, y, 0.1, "right");
    });

    // The foot.
    context.fillStyle = PAPER;
    context.fillRect(MARGIN, 1766, W - MARGIN * 2, 3);
    context.fillStyle = DIM;
    context.font = `500 24px ${fonts.mono}`;
    spaced(context, "54TH SHIBAURA FESTIVAL", MARGIN, 1818, 0.14);
    spaced(context, "END OF LOG", W - MARGIN, 1818, 0.14, "right");

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("作品を書き出せませんでした。"))), "image/jpeg", 0.92),
    );
  } finally {
    bitmaps.forEach((bitmap) => bitmap.close());
  }
}

/** The file name a saved keepsake or photo gets: TRACE_2026-10-31.jpg, or with the photo's time. */
export function imageName(takenAt: string, withTime = false): string {
  const date = new Date(takenAt);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `TRACE_${day}${withTime ? `_${pad(date.getHours())}${pad(date.getMinutes())}` : ""}.jpg`;
}
