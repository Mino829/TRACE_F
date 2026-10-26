import type { Capture } from "./record";
/** A capture with nothing in it: what a record holds where no position was asked for. */
export function emptyCapture(): Capture {
  const now = Date.now();
  return { startedAt: now, endedAt: now, options: {}, fixes: [], coarse: null, coarseError: null, errors: [] };
}
