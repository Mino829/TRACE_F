import type { PhotoMeta } from "./record";

const MAX_PHOTO_EDGE = 1280;

/**
 * Re-encode the participant's photo to a small JPEG. The original EXIF,
 * including camera GPS tags, is neither parsed into the record nor copied
 * into the output.
 */
export async function preparePhoto(file: File): Promise<{ blob: Blob; meta: PhotoMeta }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const meta: PhotoMeta = { type: file.type, bytes: file.size, width: bitmap.width, height: bitmap.height, lastModified: file.lastModified, exif: null };
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
