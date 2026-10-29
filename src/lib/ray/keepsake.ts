/**
 * The keepsake (作品, #14): the photos a participant took before arriving at
 * ShibaLab, in the order taken, on one image the shape of a phone's screen.
 * One line of light runs through the brightest point of each photo, from the
 * first photo to the last.
 *
 * Drawn on a canvas in the room's ink and handed back as a JPEG, which
 * carries no metadata: no place, no time stamp, no phone.
 */

import { brightest } from "./fx";

export type KeepsakePhoto = { blob: Blob; takenAt: string; number: number };

/** Laid out in units of a 1080 × 1920 page, drawn at 4/3 of that: 1440 × 2560 px. */
const W = 1080;
const H = 1920;
const SCALE = 4 / 3;
const MARGIN = 72;

/** The room's colours (stage.tsx): SWAP drawn as a difference trades paper and ink exactly. */
const PAPER = "#d3d5d3";
const INK = "#0c0c0d";
const SWAP = "#dfe1e0";
const DIM = "#a2a4a7";

/** Between photos across and down, and the caption's band under each. */
const GAP_X = 36;
const GAP_Y = 40;
const CAPTION = 46;
/** The square around each photo's brightest point, where the line of light passes. */
const MARK = 30;

const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

type Box = { x: number; y: number; w: number; h: number };
type Point = { x: number; y: number };
type Fonts = { latin: string; mono: string };

const pad = (value: number) => String(value).padStart(2, "0");
const clockOf = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** A photo of this width over height, as large as fits the box. */
function fit(ratio: number, width: number, height: number): { w: number; h: number } {
  return ratio > width / height ? { w: width, h: width / ratio } : { w: height * ratio, h: height };
}

/**
 * Where each photo goes: rows read left to right, then right to left, so the
 * line runs on from one photo to the next without crossing the page. The
 * column count is the one that shows the photos largest; a row's photos
 * stand on one caption line, and the rows sit in the middle of the area.
 */
export function arrange(ratios: number[], area: Box): Box[] {
  const n = ratios.length;
  const sizeFor = (cols: number) => {
    const rows = Math.ceil(n / cols);
    const cellW = (area.w - (cols - 1) * GAP_X) / cols;
    const cellH = (area.h - (rows - 1) * GAP_Y) / rows - CAPTION;
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
      const place = index - row * cols;
      const col = row % 2 ? cols - 1 - place : place;
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

/** The brightest point of the photo, as fractions of its width and height, from a small copy. */
function rayOf(bitmap: ImageBitmap): Point {
  const scale = 120 / Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(bitmap.width * scale));
  canvas.height = Math.max(8, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { x: 0.5, y: 0.5 };
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return brightest(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

/** The line from a to b, stopping at the edge of the squares around both. */
function trimmed(a: Point, b: Point): [Point, Point] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const ux = dx / length;
  const uy = dy / length;
  const cut = MARK / 2 / Math.max(Math.abs(ux), Math.abs(uy));
  if (length <= cut * 2) return null;
  return [
    { x: a.x + ux * cut, y: a.y + uy * cut },
    { x: b.x - ux * cut, y: b.y - uy * cut },
  ];
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
    const fonts = await fontsFor(root, `ShibaLab 301 ${span} ${photos.length}枚 ${captions.flat().join(" ")} 54TH SHIBAURA FESTIVAL END OF LOG`);

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

    // The photos in their own colours, each in a hairline frame.
    const boxes = arrange(
      bitmaps.map((bitmap) => bitmap.width / bitmap.height),
      { x: MARGIN, y: 446, w: W - MARGIN * 2, h: 1262 },
    );
    const rays = bitmaps.map((bitmap, index) => {
      const box = boxes[index];
      context.drawImage(bitmap, box.x, box.y, box.w, box.h);
      context.strokeStyle = PAPER;
      context.lineWidth = 2;
      context.strokeRect(box.x + 1, box.y + 1, box.w - 2, box.h - 2);
      const ray = rayOf(bitmap);
      return { x: box.x + ray.x * box.w, y: box.y + ray.y * box.h };
    });

    // Where each caption goes, which the line passes behind.
    context.font = `500 24px ${fonts.mono}`;
    const textWidth = (text: string) => [...text].reduce((sum, char) => sum + context.measureText(char).width, 0) + 24 * 0.1 * ([...text].length - 1);
    const labels = boxes.flatMap((box, index) => {
      const [frame, time] = captions[index];
      const y = box.y + box.h + 34;
      return [
        { text: frame, x: box.x + 2, y, align: "left" as const, width: textWidth(frame) },
        { text: time, x: box.x + box.w - 2, y, align: "right" as const, width: textWidth(time) },
      ];
    });

    // The line of light, from the first photo's brightest point to the last's. Drawn as a difference, it shows on ink and on any photo.
    context.save();
    context.beginPath();
    context.rect(0, 0, W, H);
    labels.forEach((label) => context.rect(label.align === "right" ? label.x - label.width - 8 : label.x - 8, label.y - 26, label.width + 16, 36));
    context.clip("evenodd");
    context.globalCompositeOperation = "difference";
    context.strokeStyle = SWAP;
    context.lineWidth = 3;
    context.lineCap = "butt";
    rays.slice(1).forEach((point, index) => {
      const segment = trimmed(rays[index], point);
      if (!segment) return;
      context.beginPath();
      context.moveTo(segment[0].x, segment[0].y);
      context.lineTo(segment[1].x, segment[1].y);
      context.stroke();
    });
    rays.forEach((point) => context.strokeRect(point.x - MARK / 2, point.y - MARK / 2, MARK, MARK));
    context.restore();

    // Each photo's frame number and time under it.
    context.font = `500 24px ${fonts.mono}`;
    context.fillStyle = PAPER;
    labels.forEach((label) => spaced(context, label.text, label.x, label.y, 0.1, label.align));

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
