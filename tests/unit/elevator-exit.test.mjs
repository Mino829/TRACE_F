import assert from "node:assert/strict";
import { test } from "node:test";

import { elevatorDistance, elevatorExit } from "../../src/lib/display/route-path.ts";

/** A walk into a car from the west, up two floors, and out of the doors to the east. */
const path = {
  points: [
    [-3, 0, 0],
    [0, 0, 0],
    [0, 5, 0],
    [0, 10, 0],
    [0.2, 10, 0],
    [3, 10, 0],
  ],
  at: [0, 3, 8, 13, 13.2, 16],
  length: 16,
  stops: [],
  places: [],
  kinds: ["indoor", "elevator", "elevator", "indoor", "indoor"],
};

test("riding, the walk faces the way out at the floor where the ride ends", () => {
  assert.deepEqual(elevatorExit(path, 5), [1, 0, 0]);
  assert.deepEqual(elevatorExit(path, 10), [1, 0, 0]);
});

test("off the elevator there is no way out to face", () => {
  assert.equal(elevatorExit(path, 1), null);
  assert.equal(elevatorExit(path, 14), null);
});

test("a walk that ends in the car has no way out", () => {
  const ending = { ...path, points: path.points.slice(0, 4), at: path.at.slice(0, 4), length: 13, kinds: path.kinds.slice(0, 3) };
  assert.equal(elevatorExit(ending, 5), null);
});

test("the distance to the nearest ride shrinks to 0 in the car (the walk stops rounding corners there)", () => {
  assert.equal(elevatorDistance(path, 1), 2);
  assert.equal(elevatorDistance(path, 5), 0);
  assert.equal(elevatorDistance(path, 14), 1);
  assert.equal(elevatorDistance({ ...path, kinds: path.kinds.map(() => "indoor") }, 5), Infinity);
});
