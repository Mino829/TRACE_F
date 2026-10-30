import assert from "node:assert/strict";
import { test } from "node:test";

import { EDGES, METRES, NODES, routeThrough } from "../../src/lib/display/campus-graph.ts";
import { TEST_ROUTES } from "../test-routes.ts";

/**
 * Each test walk (tests/test-routes.ts), expanded the way an arrival is (by
 * metres, like TRACE_B): it reaches ShibaLab along edges of the network, and
 * changes floor and crosses bridges exactly where it should. The checks are
 * about heights and the way between them, not waypoint ids, so they hold when
 * the network gains points around walls.
 */
const KIND = new Map(EDGES.flatMap((e) => [[`${e.from}|${e.to}`, e.kind], [`${e.to}|${e.from}`, e.kind]]));

for (const route of TEST_ROUTES) {
  test(`${route.id}: ${route.name}`, () => {
    const ids = routeThrough(route.stops, METRES);
    assert.equal(ids.at(-1), "shibalab");
    const legs = ids.slice(1).map((id, i) => {
      const a = NODES.get(ids[i]);
      const b = NODES.get(id);
      return { a, b, kind: KIND.get(`${a.id}|${b.id}`) };
    });
    assert.ok(legs.every((l) => l.kind), "every leg is an edge of the network");
    const changes = legs.filter((l) => l.a.threeD.z !== l.b.threeD.z).map((l) => `${l.a.threeD.z}→${l.b.threeD.z} ${l.kind}`);
    assert.deepEqual(changes, route.floorChanges, "changes floor where it should, by the right way");
    const bridges = [...new Set(legs.filter((l) => l.kind === "bridge").map((l) => l.b.threeD.z))].sort((x, y) => x - y);
    assert.deepEqual(bridges, route.bridges, "crosses bridges at the right floors");
  });
}
