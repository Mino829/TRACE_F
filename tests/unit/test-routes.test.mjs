import assert from "node:assert/strict";
import { test } from "node:test";

import { EDGES, METRES, NODES, routeThrough } from "../../src/lib/display/campus-graph.ts";

/**
 * Walks the exhibit should be able to replay (issue #76). Each is the stops
 * a tester passes as /display?stops=..., expanded the way an arrival is (by
 * metres, like TRACE_B). The checks are about floors and the way between them,
 * not the waypoint ids, so they hold when the network gains points around walls.
 */
const KIND = new Map(EDGES.flatMap((e) => [[`${e.from}|${e.to}`, e.kind], [`${e.to}|${e.from}`, e.kind]]));

function walk(stops) {
  const ids = routeThrough(stops, METRES);
  const legs = ids.slice(1).map((id, i) => {
    const a = NODES.get(ids[i]);
    const b = NODES.get(id);
    return { from: a, to: b, kind: KIND.get(`${a.id}|${b.id}`) };
  });
  return { ids, legs };
}

/** The legs where the walk changes floor, as "16→11 escalator". */
const floorChanges = (legs) =>
  legs.filter((l) => l.from.threeD.z !== l.to.threeD.z).map((l) => `${l.from.threeD.z}→${l.to.threeD.z} ${l.kind}`);

test("研究棟 11F → EV B で 6F → 渡り廊下 → 教室棟 → エスカレーターで 3F → ShibaLab", () => {
  const { ids, legs } = walk(["research-11f-east", "research-6f-east", "classroom-research-6f-bridge", "k6-019", "shibalab"]);
  assert.equal(ids.at(-1), "shibalab");
  assert.ok(legs.every((l) => l.kind), "every leg is an edge of the network");
  const bridge = legs.findIndex((l) => l.kind === "bridge");
  assert.ok(bridge > 0, "crosses the 6F bridge");
  const before = legs.slice(0, bridge);
  const after = legs.slice(bridge);
  assert.ok(before.every((l) => l.from.building === "研究棟"), "stays in the research building down to the bridge");
  assert.ok(floorChanges(before).every((c) => c.endsWith("elevator")), "goes down by elevator");
  assert.equal(before.at(-1).to.threeD.z, 26, "reaches the bridge at 6F");
  assert.ok(after.filter((l) => l.kind === "bridge").every((l) => l.from.threeD.z === 26 && l.to.threeD.z === 26), "the bridge is at 6F");
  assert.deepEqual(floorChanges(after), ["26→21 escalator", "21→16 escalator", "16→11 escalator"], "6F → 5F → 4F → 3F by escalator only");
});

test("本部棟 11F → 4F → 渡り廊下で交流棟 4F → 渡り廊下で教室棟 4F → エスカレーターで 3F → ShibaLab", () => {
  const { ids, legs } = walk(["hq-11f", "hq-4f-bridge", "x4-025", "x4-024", "classroom-4f-lobby", "classroom-3f-lobby", "shibalab"]);
  assert.equal(ids.at(-1), "shibalab");
  assert.ok(legs.every((l) => l.kind), "every leg is an edge of the network");
  const bridges = legs.filter((l) => l.kind === "bridge");
  assert.ok(bridges.some((l) => l.from.building === "本部棟" || l.to.building === "本部棟"), "a bridge leaves the main building");
  assert.ok(bridges.some((l) => l.from.building === "教室棟" || l.to.building === "教室棟"), "a bridge reaches the classroom building");
  assert.ok(bridges.every((l) => l.from.threeD.z === 16 && l.to.threeD.z === 16), "both bridges are at 4F");
  const first = legs.findIndex((l) => l.kind === "bridge");
  assert.ok(legs.slice(0, first).every((l) => l.from.building === "本部棟"), "stays in the main building down to the bridge");
  assert.ok(floorChanges(legs.slice(0, first)).every((c) => c.endsWith("elevator")), "goes down by elevator");
  assert.ok(legs.filter((l) => l.from.building === "交流棟").every((l) => l.from.threeD.z === 16), "the exchange building only at 4F");
  assert.deepEqual(floorChanges(legs.slice(first)), ["16→11 escalator"], "4F → 3F by escalator only");
});
