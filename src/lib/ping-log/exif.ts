/**
 * Reads the few EXIF fields worth keeping from a phone photo: the camera's
 * own position and direction (a second, independent fix when the camera app
 * tags location), when it was taken, and what lens took it. The photo is
 * shrunk by re-encoding before it is sent, which drops all of this, so it is
 * read from the original first.
 */

export type ExifSummary = {
  make: string | null;
  model: string | null;
  software: string | null;
  orientation: number | null;
  dateTimeOriginal: string | null;
  offsetTimeOriginal: string | null;
  focalLength: number | null;
  focalLength35mm: number | null;
  lensModel: string | null;
  gps: {
    latitude: number | null;
    longitude: number | null;
    altitude: number | null;
    horizontalError: number | null;
    dop: number | null;
    imgDirection: number | null;
    imgDirectionRef: string | null;
    speed: number | null;
    speedRef: string | null;
    dateStamp: string | null;
    timeStamp: number[] | null;
    mapDatum: string | null;
  } | null;
};

type Value = string | number | number[];

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
/** APP1 is at most 64 KB and sits right after the start marker. */
const HEAD_BYTES = 128 * 1024;

export async function readExif(file: Blob): Promise<ExifSummary | null> {
  try {
    const view = new DataView(await file.slice(0, HEAD_BYTES).arrayBuffer());
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 10 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
      if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) return parseTiff(view, offset + 10);
      offset += 2 + view.getUint16(offset + 2);
    }
    return null;
  } catch {
    return null;
  }
}

function parseTiff(view: DataView, start: number): ExifSummary | null {
  const little = view.getUint16(start) === 0x4949;
  const inside = (offset: number, bytes: number) => start + offset + bytes <= view.byteLength;
  const u16 = (offset: number) => view.getUint16(start + offset, little);
  const u32 = (offset: number) => view.getUint32(start + offset, little);
  if (!inside(0, 8) || u16(2) !== 42) return null;

  const readValue = (type: number, count: number, offset: number): Value => {
    if (type === 2) {
      let textValue = "";
      for (let index = 0; index < count; index += 1) textValue += String.fromCharCode(view.getUint8(start + offset + index));
      return textValue.replace(/\0+$/, "").trim();
    }
    const values: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const at = start + offset + index * TYPE_SIZE[type];
      if (type === 3) values.push(view.getUint16(at, little));
      else if (type === 4) values.push(view.getUint32(at, little));
      else if (type === 9) values.push(view.getInt32(at, little));
      else if (type === 5 || type === 10) {
        const numerator = type === 5 ? view.getUint32(at, little) : view.getInt32(at, little);
        const denominator = type === 5 ? view.getUint32(at + 4, little) : view.getInt32(at + 4, little);
        values.push(denominator === 0 ? NaN : numerator / denominator);
      } else values.push(view.getUint8(at));
    }
    return values.length === 1 ? values[0] : values;
  };

  const readIfd = (ifd: number): Map<number, Value> => {
    const tags = new Map<number, Value>();
    if (!ifd || !inside(ifd, 2)) return tags;
    const count = u16(ifd);
    for (let index = 0; index < count; index += 1) {
      const entry = ifd + 2 + index * 12;
      if (!inside(entry, 12)) break;
      const type = u16(entry + 2);
      const items = u32(entry + 4);
      const size = TYPE_SIZE[type];
      if (!size || items > 4096) continue;
      const valueOffset = size * items <= 4 ? entry + 8 : u32(entry + 8);
      if (inside(valueOffset, size * items)) tags.set(u16(entry), readValue(type, items, valueOffset));
    }
    return tags;
  };

  const ifd0 = readIfd(u32(4));
  const exif = readIfd(Number(ifd0.get(0x8769) ?? 0));
  const gps = ifd0.has(0x8825) ? readIfd(Number(ifd0.get(0x8825))) : null;
  const text = (tags: Map<number, Value> | null, tag: number) => (typeof tags?.get(tag) === "string" ? (tags.get(tag) as string) || null : null);
  const number = (tags: Map<number, Value> | null, tag: number) => {
    const value = tags?.get(tag);
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const degrees = (tag: number, refTag: number, negative: string) => {
    const value = gps?.get(tag);
    if (!Array.isArray(value) || value.length !== 3 || value.some((part) => !Number.isFinite(part))) return null;
    const decimal = value[0] + value[1] / 60 + value[2] / 3600;
    return text(gps, refTag) === negative ? -decimal : decimal;
  };
  const altitude = number(gps, 0x06);
  const altitudeRef = gps?.get(0x05);

  return {
    make: text(ifd0, 0x010f),
    model: text(ifd0, 0x0110),
    software: text(ifd0, 0x0131),
    orientation: number(ifd0, 0x0112),
    dateTimeOriginal: text(exif, 0x9003),
    offsetTimeOriginal: text(exif, 0x9011),
    focalLength: number(exif, 0x920a),
    focalLength35mm: number(exif, 0xa405),
    lensModel: text(exif, 0xa434),
    gps: gps && gps.size > 0 ? {
      latitude: degrees(0x02, 0x01, "S"),
      longitude: degrees(0x04, 0x03, "W"),
      altitude: altitude === null ? null : altitudeRef === 1 ? -altitude : altitude,
      horizontalError: number(gps, 0x1f),
      dop: number(gps, 0x0b),
      imgDirection: number(gps, 0x11),
      imgDirectionRef: text(gps, 0x10),
      speed: number(gps, 0x0d),
      speedRef: text(gps, 0x0c),
      dateStamp: text(gps, 0x1d),
      timeStamp: Array.isArray(gps.get(0x07)) ? (gps.get(0x07) as number[]) : null,
      mapDatum: text(gps, 0x12),
    } : null,
  };
}
