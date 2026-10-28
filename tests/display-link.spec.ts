import { test, expect, type Page, type WebSocketRoute } from "@playwright/test";

/**
 * The booth taking arrivals from TRACE_B (issue #36), the way
 * trace-campus-installation#32 / TRACE_B#37 connect it: Google sign-in, a short
 * display credential, then the browser's own WebSocket straight to TRACE_B.
 *
 * Playwright stands in for Google Identity Services, the credential API and
 * TRACE_B's /v1/display/ws (frames as in TRACE_B internal/api/display.go).
 * The dev server must run with
 *   NEXT_PUBLIC_DISPLAY_API_URL=https://api.test NEXT_PUBLIC_GOOGLE_CLIENT_ID=test-client
 */

const API = "https://api.test";
const WS = "wss://api.test/v1/display/ws";
const ROUTE = ["o-126", "grand-stairs-bottom", "shibalab"];

type Sent = Record<string, unknown> & { type: string };

function frame(type: string, data: unknown, eventId = `ev-${Math.random().toString(36).slice(2)}`) {
  return JSON.stringify({ schemaVersion: 1, coordinateVersion: "c", campusGraphVersion: "g", threeDMapVersion: "m", eventId, type, occurredAt: new Date().toISOString(), data });
}

type Backend = {
  sent: Sent[];
  tokenRequests: string[];
  send: (type: string, data: unknown, eventId?: string) => void;
  close: (code: number) => void;
  of: (type: string) => Sent[];
};

/** A fake Google sign-in and a fake TRACE_B. */
async function backend(page: Page, opts: { grant?: boolean; ack?: (msg: Sent) => "ack" | "reject" } = {}): Promise<Backend> {
  const sent: Sent[] = [];
  const tokenRequests: string[] = [];
  let server: WebSocketRoute | null = null;
  await page.addInitScript(() => {
    let callback: ((response: { credential?: string }) => void) | null = null;
    (window as unknown as { google: unknown }).google = {
      accounts: {
        id: {
          initialize: (config: { callback: (response: { credential?: string }) => void }) => {
            callback = config.callback;
          },
          renderButton: (parent: HTMLElement) => {
            const button = document.createElement("button");
            button.textContent = "テスト用 Google ログイン";
            button.onclick = () => callback?.({ credential: "google-id-token" });
            parent.appendChild(button);
          },
          prompt: () => undefined,
        },
      },
    };
  });
  await page.route(`${API}/v1/operator/display-tokens`, async (route) => {
    tokenRequests.push(route.request().headers()["authorization"] ?? "");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ displayToken: "display-token-1", expiresAt: new Date(Date.now() + 120000).toISOString() }) });
  });
  await page.routeWebSocket(WS, (ws) => {
    server = ws;
    ws.onMessage((message) => {
      const msg = JSON.parse(String(message)) as Sent;
      sent.push(msg);
      if (msg.type === "renderer.authenticate") ws.send(frame("display.snapshot", { cursor: 0, arrivals: [] }, "0"));
      if (msg.type === "renderer.primary.acquire") {
        ws.send(opts.grant === false ? frame("renderer.primary.conflict", {}) : frame("renderer.primary.granted", { leaseId: "lease-1234" }));
      }
      if (msg.type === "arrival.replay.started") {
        const answer = opts.ack?.(msg) ?? "ack";
        ws.send(
          answer === "ack"
            ? frame("renderer.ack", { eventId: msg.eventId, replayStatus: "playing" })
            : frame("renderer.rejected", { eventId: msg.eventId, code: "STATE_CONFLICT" }),
        );
      }
    });
  });
  return {
    sent,
    tokenRequests,
    send: (type, data, eventId) => server!.send(frame(type, data, eventId)),
    close: (code) => void server!.close({ code, reason: "test" }),
    of: (type) => sent.filter((m) => m.type === type),
  };
}

async function signIn(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/display");
  await expect(page.getByRole("button", { name: /テスト再生/ })).toBeEnabled({ timeout: 60000 });
  await expect(page.getByRole("status").filter({ hasText: "Google ログインが必要" })).toBeVisible();
  await page.getByRole("button", { name: "テスト用 Google ログイン" }).click();
  await expect(page.getByRole("status").filter({ hasText: "LINK · 再生担当" })).toBeVisible();
  return errors;
}

function arrive(b: Backend, arrivalId: string, pathNodeIds: string[], eventId: string) {
  b.send("participant.arrived", { arrivalId, replayStatus: "queued", pathNodeIds, photoCheckpoints: [{ checkpointId: pathNodeIds[0] ?? "", capturedAt: new Date().toISOString() }], replayDurationSeconds: 3 }, eventId);
  b.send("arrival.replay.requested", { arrivalId }, `${eventId}r`);
}

test("signs in with Google, authenticates by the first message, and plays an arrival only after TRACE_B confirms it", async ({ page }) => {
  const b = await backend(page);
  const errors = await signIn(page);

  // The Google ID token buys the display credential; the credential goes only in the first WebSocket message.
  expect(b.tokenRequests).toEqual(["Bearer google-id-token"]);
  const auth = b.sent[0];
  expect(auth).toMatchObject({ schemaVersion: 1, type: "renderer.authenticate", displayToken: "display-token-1" });
  for (const key of ["coordinateVersion", "campusGraphVersion", "threeDMapVersion"]) expect(typeof auth[key]).toBe("string");

  arrive(b, "arrival-0001", ROUTE, "1");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback");
  expect(b.of("arrival.replay.started")[0]).toMatchObject({ arrivalId: "arrival-0001", leaseId: "lease-1234" });
  await expect(page.locator(".dsp-tests").getByText("ARRIVAL", { exact: true })).toBeVisible();

  // Completed as the walk ends, then the card holds the booth before the QR comes back.
  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  await expect.poll(() => b.of("arrival.replay.completed").length).toBe(1);
  expect(b.of("arrival.replay.completed")[0]).toMatchObject({ arrivalId: "arrival-0001", leaseId: "lease-1234" });
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "arrived");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top", { timeout: 10000 });
  expect(errors).toEqual([]);
});

test("the next visitor waits for the previous card, and a visitor without a route gets the card alone", async ({ page }) => {
  const b = await backend(page);
  const errors = await signIn(page);
  arrive(b, "arrival-0001", ROUTE, "1");
  arrive(b, "arrival-0002", [], "2");
  await expect(page.getByText("ShibaLab に到着しました")).toBeVisible({ timeout: 15000 });
  // While the first card is up, the second has not been asked to start.
  await expect.poll(() => b.of("arrival.replay.completed").length).toBe(1);
  expect(b.of("arrival.replay.started")).toHaveLength(1);
  // Then the second starts: no route, so the card alone, reported completed.
  await expect.poll(() => b.of("arrival.replay.started").length, { timeout: 10000 }).toBe(2);
  await expect.poll(() => b.of("arrival.replay.completed").length).toBe(2);
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top", { timeout: 10000 });
  expect(errors).toEqual([]);
});

test("a start TRACE_B rejects is dropped and the next arrival plays", async ({ page }) => {
  const b = await backend(page, { ack: (msg) => (msg.arrivalId === "arrival-0001" ? "reject" : "ack") });
  const errors = await signIn(page);
  arrive(b, "arrival-0001", ROUTE, "1");
  arrive(b, "arrival-0002", ROUTE, "2");
  await expect.poll(() => b.of("arrival.replay.started").map((m) => m.arrivalId)).toEqual(["arrival-0001", "arrival-0002"]);
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback");
  await expect.poll(() => b.of("arrival.replay.completed").map((m) => m.arrivalId), { timeout: 15000 }).toEqual(["arrival-0002"]);
  expect(errors).toEqual([]);
});

test("a skip while playing goes back to the top and is not reported", async ({ page }) => {
  const b = await backend(page);
  const errors = await signIn(page);
  b.send("participant.arrived", { arrivalId: "arrival-0003", replayStatus: "queued", pathNodeIds: ROUTE, photoCheckpoints: [], replayDurationSeconds: 30 }, "1");
  b.send("arrival.replay.requested", { arrivalId: "arrival-0003" }, "2");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "playback");
  b.send("arrival.replay.skipped", { arrivalId: "arrival-0003", reason: "operator" }, "3");
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  await page.waitForTimeout(500);
  expect(b.of("arrival.replay.completed")).toHaveLength(0);
  expect(b.of("arrival.replay.failed")).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("other versions (close 4409) stop the link instead of reconnecting", async ({ page }) => {
  const b = await backend(page);
  const errors = await signIn(page);
  b.close(4409);
  await expect(page.getByRole("status").filter({ hasText: "つなげません" })).toBeVisible();
  await page.waitForTimeout(2500);
  expect(b.tokenRequests).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("without the lease the booth waits on standby and plays nothing", async ({ page }) => {
  const b = await backend(page, { grant: false });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/display");
  await expect(page.getByRole("button", { name: /テスト再生/ })).toBeEnabled({ timeout: 60000 });
  await page.getByRole("button", { name: "テスト用 Google ログイン" }).click();
  await expect(page.getByRole("status").filter({ hasText: "LINK · 待機" })).toBeVisible();
  arrive(b, "arrival-0004", ROUTE, "1");
  await page.waitForTimeout(500);
  await expect(page.locator(".dsp")).toHaveAttribute("data-screen", "top");
  expect(b.of("arrival.replay.started")).toHaveLength(0);
  expect(errors).toEqual([]);
});
