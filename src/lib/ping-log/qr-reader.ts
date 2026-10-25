/**
 * Reads the booth's arrival QR from the camera.
 *
 * A browser with the Barcode Detection API (Chrome on Android) reads with it.
 * The rest, iPhone Safari among them (it keeps the API off by default), use
 * the barcode-detector ponyfill: the same API over ZXing compiled to
 * WebAssembly, loaded only then. Its wasm comes from this site, not the
 * library's default CDN, so reading a code asks no other server for anything.
 */

export type DetectedCode = { rawValue: string; cornerPoints: ReadonlyArray<{ x: number; y: number }> };

export type CodeReader = { detect: (source: HTMLVideoElement) => Promise<DetectedCode[]> };

type NativeDetector = {
  new (options: { formats: string[] }): CodeReader;
  getSupportedFormats: () => Promise<string[]>;
};

let reader: Promise<CodeReader> | null = null;

/** The reader, made once per page. A failed load is tried again on the next call. */
export function qrReader(): Promise<CodeReader> {
  reader ??= loadReader().catch((error: unknown) => {
    reader = null;
    throw error;
  });
  return reader;
}

async function loadReader(): Promise<CodeReader> {
  const Native = (globalThis as { BarcodeDetector?: NativeDetector }).BarcodeDetector;
  if (Native && (await Native.getSupportedFormats().catch((): string[] => [])).includes("qr_code")) {
    return new Native({ formats: ["qr_code"] });
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  const wasm = new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url).href;
  await prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasm : prefix + path) },
    fireImmediately: true,
  });
  return new BarcodeDetector({ formats: ["qr_code"] });
}

/**
 * Whether a read text can be an arrival code: TRACE_B's signed token, two
 * base64url parts joined by a dot, 30 to 2048 characters. A URL, such as the
 * site's own QR at the entrance, is not one and is never sent.
 */
export function isArrivalCode(text: string): boolean {
  return text.length >= 30 && text.length <= 2048 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text);
}
