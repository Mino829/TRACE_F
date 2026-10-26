import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * The booth taking arrivals from TRACE_B's display WebSocket (issue #36).
 * Playwright stands in for the arrival-issuer relay and TRACE_B: the frames are
 * the ones TRACE_B sends (internal/api/display.go), and every message the page
 * sends back is checked.
 */

const WS = "ws://display.test/ws";

type Sent = Record<string, unknown> & { type: string };

function frame(type: string, data: unknown, eventId = `ev-${Math.random().toString(36).slice(2)}`) {
  return JSON.stringify({ schemaVersion: 1, coordinateVersion: "c", campusGraphVersion: "g", threeDMapVersion: "m", eventId, type, occurredAt: new Date().toISOString(), data });
}

/** A fake TRACE_B: grants the lease (or not) and keeps what the page sends. */
async function backend(page: Page, opts: { grant?: boolean } = {}) {
  const sent: Sent[] = [];
  let server: WebSocketRoute | null = null;
  await page.routeWebSocket(WS, (ws) => {
    server = ws;
    ws.send(frame("display.snapshot", { cursor: 0, participants: [], arrivals: [] }, "0"));
    ws.onMessage((message) => {
      const msg = JSON.parse(String(message)) as Sent;
      sent.push(msg);
      if (msg.type === "renderer.primary.acquire") {
        ws.send(opts.grant === false ? frame("renderer.primary.conflict", {}) : frame("renderer.primary.granted", { leaseId: "lease-1234" }));
      }
    });
  });
  return {
    sent,
    send: (type: string, data: unknown, eventId?: string) => server!.send(frame(type, data, eventId)),
    of: (type: string) => sent.filter((m) => m.type === type),
  };
}

async function open(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto(`/display?ws=${encodeURIComponent(WS)}`);
  await expect(page.getByRole("button", { name: /テスト再生/ })).toBeEnabled({ timeout: 60000 });
  return errors;
}

test("an arrival plays as the primary renderer and is reported started, then completed after its card", async ({ page }) => {
  const b = await backend(page);
  const errors = await open(page);
  await expect(page.getByRole("status").filter({ hasText: "LINK · 再生担当" })).toBeVisible();

  // Every message carries the schema and the three versions of this bundle.
  const acquire = b.of("renderer.primary.acquire")[0];
  expect(acquire).toMatchObject({ schemaVersion: 1 });
  for (const key of ["coordinateVersion", "campusGraphVersion", "threeDMapVersion"]) expect(typeof acquire[key]).toBe("string");

  b.send("participant.arrived", { arrivalId: "arrival-0001", replayStatus: "queued", replayDurationSeconds: 3 }, "1");
  b.send("arrival.replay.requested", { arrivalId: "arrival-0001" }, "2");
  // The same event again (as after a reconnect) is not played twice.
  b.send("arrival.replay.requested", { arrivalId: "arrival-0001" }, "2");

  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback");
  // TRACE_B sends no route yet, so the walk is a demo one, and says so.
  await expect(page.getByText("ARRIVAL · DEMO ROUTE")).toBeVisible();
  await expect.poll(() => b.of("arrival.replay.started").length).toBe(1);
  expect(b.of("arrival.replay.started")[0]).toMatchObject({ arrivalId: "arrival-0001", leaseId: "lease-1234" });

  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  // Completed only once the card has been up, then back to the top.
  expect(b.of("arrival.replay.completed")).toHaveLength(0);
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top", { timeout: 15000 });
  await expect.poll(() => b.of("arrival.replay.completed").length).toBe(1);
  const completed = b.of("arrival.replay.completed")[0];
  expect(completed).toMatchObject({ arrivalId: "arrival-0001", leaseId: "lease-1234" });
  expect(String(completed.eventId)).not.toBe(String(b.of("arrival.replay.started")[0].eventId));
  expect(errors).toEqual([]);
});

test("a route TRACE_B sends is walked as it is, not the demo", async ({ page }) => {
  const b = await backend(page);
  const errors = await open(page);
  await expect(page.getByRole("status").filter({ hasText: "LINK · 再生担当" })).toBeVisible();
  b.send("participant.arrived", { arrivalId: "arrival-0002", replayDurationSeconds: 3, route: { nodeIds: ["o-126", "grand-stairs-bottom", "shibalab"] } }, "1");
  b.send("arrival.replay.requested", { arrivalId: "arrival-0002" }, "2");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback");
  await expect(page.locator(".dsp-tests").getByText("ARRIVAL", { exact: true })).toBeVisible();
  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test("a skip while playing goes back to the top and is not reported", async ({ page }) => {
  const b = await backend(page);
  const errors = await open(page);
  await expect(page.getByRole("status").filter({ hasText: "LINK · 再生担当" })).toBeVisible();
  b.send("participant.arrived", { arrivalId: "arrival-0003", replayDurationSeconds: 30 }, "1");
  b.send("arrival.replay.requested", { arrivalId: "arrival-0003" }, "2");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback");
  b.send("arrival.replay.skipped", { arrivalId: "arrival-0003", reason: "operator" }, "3");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  await page.waitForTimeout(500);
  expect(b.of("arrival.replay.completed")).toHaveLength(0);
  expect(b.of("arrival.replay.failed")).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("without the lease the booth waits on standby and plays nothing", async ({ page }) => {
  const b = await backend(page, { grant: false });
  const errors = await open(page);
  await expect(page.getByRole("status").filter({ hasText: "LINK · 待機" })).toBeVisible();
  b.send("arrival.replay.requested", { arrivalId: "arrival-0004" }, "2");
  await page.waitForTimeout(500);
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  expect(b.of("arrival.replay.started")).toHaveLength(0);
  expect(errors).toEqual([]);
});
