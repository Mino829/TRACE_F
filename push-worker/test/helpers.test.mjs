import assert from "node:assert/strict";
import { test } from "node:test";

import { endOfDayJst, haversineMetres } from "../src/helpers.ts";

test("a subscription made during a Japanese day ends at the next midnight JST", () => {
  // 2026-10-07 10:00 JST
  assert.equal(endOfDayJst(Date.parse("2026-10-07T01:00:00Z")), "2026-10-07T15:00:00.000Z");
  // 2026-10-07 23:59 JST is still the same day
  assert.equal(endOfDayJst(Date.parse("2026-10-07T14:59:00Z")), "2026-10-07T15:00:00.000Z");
  // 2026-10-08 00:00 JST starts the next one
  assert.equal(endOfDayJst(Date.parse("2026-10-07T15:00:00Z")), "2026-10-08T15:00:00.000Z");
});

test("haversine distance matches a known short baseline", () => {
  // One thousandth of a degree of latitude is about 111 m anywhere.
  const metres = haversineMetres({ lat: 35.66, lon: 139.79 }, { lat: 35.661, lon: 139.79 });
  assert.ok(Math.abs(metres - 111.2) < 0.5, `${metres}`);
});
