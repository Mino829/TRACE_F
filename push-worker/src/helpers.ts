const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
