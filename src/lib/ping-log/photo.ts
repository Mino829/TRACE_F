import { readExif } from "./exif";
import type { PhotoMeta } from "./record";

const MAX_PHOTO_EDGE = 1280;

/**
 * Phone photos are several MB; keep a JPEG small enough to send over a campus
 * connection, and keep what the original said about itself before the
 * re-encode throws it away.
 */
export async function preparePhoto(file: File): Promise<{ blob: Blob; meta: PhotoMeta }> {
  const exif = await readExif(file);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const meta: PhotoMeta = { type: file.type, bytes: file.size, width: bitmap.width, height: bitmap.height, lastModified: file.lastModified, exif };
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("写真を変換できませんでした。"))), "image/jpeg", 0.8),
  );
  return { blob, meta };
}
