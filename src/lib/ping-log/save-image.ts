import { isIos } from "./environment";

/**
 * Saving an image from /log to the phone (#14). An iPhone or iPad saves
 * through the share sheet's 「画像を保存」; a download there lands in Files,
 * not Photos. Android's Chrome and a computer download it. The share sheet
 * needs the tap that opened it, so the file has to be ready before the tap.
 */

/** cancelled: the share sheet was closed. unsupported: this browser cannot hand the file over; the image can still be long-pressed. */
export type SaveResult = "saved" | "cancelled" | "unsupported";

export async function saveImage(file: File): Promise<SaveResult> {
  if (isIos()) {
    if (!navigator.canShare?.({ files: [file] })) return "unsupported";
    try {
      await navigator.share({ files: [file] });
      return "saved";
    } catch (error) {
      return error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "unsupported";
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // The download has its own copy by then.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "saved";
}

/** What to say when the file could not be handed over: the picture on the screen can still be saved by hand. */
export const LONG_PRESS = "この端末では、ボタンから保存できませんでした。画像を長く押すと出るメニューから保存してください。";
