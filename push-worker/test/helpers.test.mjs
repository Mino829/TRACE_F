import assert from "node:assert/strict";
import { test } from "node:test";

import { endOfDayJst, haversineMetres, isDue, parsePlan } from "../src/helpers.ts";

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

test("each interval is due on its own marks of the Japanese clock", () => {
  // 10:15 JST is 01:15 UTC.
  assert.equal(isDue(Date.parse("2026-10-10T01:15:00Z"), 15), true);
  assert.equal(isDue(Date.parse("2026-10-10T01:20:00Z"), 15), false);
  assert.equal(isDue(Date.parse("2026-10-10T01:30:00Z"), 15), true);
  // 10:30 and 11:00 JST, not 10:45.
  assert.equal(isDue(Date.parse("2026-10-10T01:30:00Z"), 30), true);
  assert.equal(isDue(Date.parse("2026-10-10T01:45:00Z"), 30), false);
  assert.equal(isDue(Date.parse("2026-10-10T02:00:00Z"), 30), true);
  // The accuracy ping keeps its old marks, :00, :10, :20 ...
  assert.equal(isDue(Date.parse("2026-10-10T01:50:00Z"), 10), true);
  assert.equal(isDue(Date.parse("2026-10-10T01:55:00Z"), 10), false);
});

test("a run a few seconds off its minute still counts as that minute", () => {
  assert.equal(isDue(Date.parse("2026-10-10T01:15:02Z"), 15), true);
  assert.equal(isDue(Date.parse("2026-10-10T01:14:58Z"), 15), true);
});

test("only the listed plans are accepted", () => {
  assert.deepEqual(parsePlan("photo", 15), { purpose: "photo", intervalMinutes: 15 });
  assert.deepEqual(parsePlan("photo", 30), { purpose: "photo", intervalMinutes: 30 });
  assert.deepEqual(parsePlan("accuracy", 10), { purpose: "accuracy", intervalMinutes: 10 });
  assert.equal(parsePlan("photo", 10), null);
  assert.equal(parsePlan("accuracy", 15), null);
  assert.equal(parsePlan("photo", "15"), null);
  assert.equal(parsePlan("photo", undefined), null);
  assert.equal(parsePlan("other", 15), null);
});

test("a page from before plans existed still gets the accuracy ping", () => {
  assert.deepEqual(parsePlan(undefined, undefined), { purpose: "accuracy", intervalMinutes: 10 });
});
