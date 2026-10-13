import { readExif } from "./exif";
import type { PhotoMeta } from "./record";

const MAX_PHOTO_EDGE = 1280;

/**
 * Phone photos are several MB; keep a JPEG small enough to send over a campus
 * connection. The re-encode drops the original's EXIF from the JPEG. An
 * accuracy run keeps what the EXIF said in the record, read before it is
 * lost; a participant's photo leaves it behind entirely (FR-022), so pass
 * `{ exif: false }` for those.
 */
export async function preparePhoto(file: File, { exif: keepExif = true }: { exif?: boolean } = {}): Promise<{ blob: Blob; meta: PhotoMeta }> {
  const exif = keepExif ? await readExif(file) : null;
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
