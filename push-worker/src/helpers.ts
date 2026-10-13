const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Pings stop at midnight Japan time, so a phone nobody switched off is not woken all night. */
export function endOfDayJst(now: number): string {
  return new Date(Math.floor((now + JST_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - JST_OFFSET_MS).toISOString();
}

/** Great-circle distance in metres; plenty for errors of a few hundred metres. */
export function haversineMetres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
}

/** accuracy: the team's accuracy run. photo: a participant's reminder to take a photo. */
export type PushPurpose = "accuracy" | "photo";
export type PushPlan = { purpose: PushPurpose; intervalMinutes: number };

/** The intervals each purpose may ask for, in minutes; each divides an hour into marks a 5-minute cron hits. */
const INTERVALS: Record<PushPurpose, readonly number[]> = { accuracy: [10], photo: [15, 30] };

/**
 * Reads the plan a page subscribes with. A page from before plans existed
 * sends neither field and meant the 10-minute accuracy ping; anything else
 * outside the list is refused.
 */
export function parsePlan(purpose: unknown, intervalMinutes: unknown): PushPlan | null {
  if (purpose === undefined && intervalMinutes === undefined) return { purpose: "accuracy", intervalMinutes: 10 };
  if (purpose !== "accuracy" && purpose !== "photo") return null;
  if (typeof intervalMinutes !== "number" || !INTERVALS[purpose].includes(intervalMinutes)) return null;
  return { purpose, intervalMinutes };
}

/**
 * Whether a subscription is due on the cron run scheduled at `scheduledTime`.
 * The cron fires every 5 minutes, and a subscription is pinged on the runs
 * whose count of minutes since the epoch is a multiple of its interval.
 * Japan is 540 minutes ahead of UTC, a multiple of every allowed interval, so
 * the marks fall on the same minutes of the Japanese clock (:00, :15, :30 and
 * :45 for a 15-minute reminder).
 */
export function isDue(scheduledTime: number, intervalMinutes: number): boolean {
  return Math.round(scheduledTime / MINUTE_MS) % intervalMinutes === 0;
}
