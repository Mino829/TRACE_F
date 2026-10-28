import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { DISPLAY_TOKEN_PATH, createDisplayRelay } from "../display-relay.mjs";
import { readConfig, sign } from "../issuer-core.mjs";

const issuerKey = "issuer-key-for-tests-0123456789abcdef";
const displayKey = "display-issuer-key-for-tests-0123456789";
const display = "https://trace-log.example.test";
const versions = { TRACE_COORDINATE_VERSION: "coord-1", TRACE_CAMPUS_GRAPH_VERSION: "graph-1", TRACE_THREE_D_MAP_VERSION: "map-1" };

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

/** A stand-in for TRACE_B's display routes that checks requests the way display.go does. */
async function fakeTraceB(state) {
  const sockets = new WebSocketServer({ noServer: true });
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const timestamp = request.headers["x-trace-display-issuer-timestamp"];
      const valid = request.method === "POST" && request.url === DISPLAY_TOKEN_PATH && body === "" &&
        !request.headers.origin && !request.headers.authorization &&
        request.headers["x-trace-display-issuer-signature"] === sign(displayKey, "POST", DISPLAY_TOKEN_PATH, timestamp);
      if (state.tokenStatus || !valid) {
        response.writeHead(state.tokenStatus ?? 403, { "Content-Type": "application/json" });
        return response.end(JSON.stringify({ error: { code: "FORBIDDEN" } }));
      }
      state.issued += 1;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ displayToken: `display.token.${state.issued}`, expiresAt: new Date(Date.now() + 120_000).toISOString() }));
    });
  });
  server.on("upgrade", (request, socket, head) => {
    state.handshakes.push(request.headers);
    const ok = request.url === "/v1/display/ws" && !request.headers.origin &&
      request.headers.authorization === `Bearer display.token.${state.issued}` &&
      request.headers["x-trace-schema-version"] === "1" && request.headers["x-trace-coordinate-version"] === "coord-1" &&
      request.headers["x-trace-campus-graph-version"] === "graph-1" && request.headers["x-trace-three-d-map-version"] === "map-1";
    if (!ok) return socket.end("HTTP/1.1 409 Conflict\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    sockets.handleUpgrade(request, socket, head, (upstream) => state.onConnection(upstream));
  });
  const port = await listen(server);
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function relayFor(origin, overrides = {}) {
  const config = readConfig({ TRACE_API_ORIGIN: origin, TRACE_ARRIVAL_ISSUER_KEY: issuerKey, TRACE_DISPLAY_ISSUER_KEY: displayKey, DISPLAY_ORIGINS: display, ...versions, ...overrides });
  const server = createServer();
  server.on("upgrade", createDisplayRelay(config).handleUpgrade);
  return { server, port: await listen(server) };
}

function browser(port, { path = "/display-ws", origin = display } = {}) {
  // ws answers pings automatically, as a browser's WebSocket does.
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, { origin });
}

test("passes messages, pings and pongs through unchanged and adds the token and versions", async () => {
  const state = { issued: 0, handshakes: [], received: [], pongs: [] };
  let upstream;
  const connected = new Promise((resolve) => {
    state.onConnection = (socket) => {
      upstream = socket;
      socket.on("message", (data) => state.received.push(data.toString()));
      socket.on("pong", (data) => state.pongs.push(data.toString()));
      socket.send(JSON.stringify({ schemaVersion: 1, type: "display.snapshot", data: { cursor: 7 } }));
      resolve();
    };
  });
  const traceB = await fakeTraceB(state);
  const relay = await relayFor(traceB.origin);
  try {
    const client = browser(relay.port);
    const firstMessage = once(client, "message");
    await once(client, "open");
    // Sent before TRACE_B has answered: queued, then delivered in order.
    client.send(JSON.stringify({ type: "renderer.primary.acquire" }));
    client.send(JSON.stringify({ type: "renderer.heartbeat" }));
    await connected;
    const [snapshot] = await firstMessage;
    assert.equal(snapshot.toString(), JSON.stringify({ schemaVersion: 1, type: "display.snapshot", data: { cursor: 7 } }));
    while (state.received.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(state.received, [JSON.stringify({ type: "renderer.primary.acquire" }), JSON.stringify({ type: "renderer.heartbeat" })]);
    assert.equal(state.handshakes[0].authorization, "Bearer display.token.1");
    assert.equal(state.handshakes[0].origin, undefined);

    // TRACE_B's ping reaches /display, and only /display's pong goes back.
    const pong = once(upstream, "pong");
    upstream.ping("beat-1");
    await pong;
    assert.deepEqual(state.pongs, ["beat-1"]);

    const upstreamClosed = once(upstream, "close");
    client.close();
    await upstreamClosed;
  } finally {
    traceB.server.close();
    relay.server.close();
  }
});

test("a /display that stops answering pings is not kept alive by the relay", async () => {
  const state = { issued: 0, handshakes: [], pongs: [] };
  let upstream;
  const connected = new Promise((resolve) => {
    state.onConnection = (socket) => {
      upstream = socket;
      socket.on("pong", (data) => state.pongs.push(data.toString()));
      resolve();
    };
  });
  const traceB = await fakeTraceB(state);
  const relay = await relayFor(traceB.origin);
  try {
    // Stands in for a frozen page: the socket is open but nothing answers.
    const client = new WebSocket(`ws://127.0.0.1:${relay.port}/display-ws`, { origin: display, autoPong: false });
    await once(client, "open");
    await connected;
    upstream.ping("beat-1");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(state.pongs, []);
    client.close();
  } finally {
    traceB.server.close();
    relay.server.close();
  }
});

test("TRACE_B closing reaches /display with its code, and a refused handshake becomes 4000 + status", async () => {
  const state = { issued: 0, handshakes: [], onConnection: (socket) => socket.close(4001, "lease lost") };
  const traceB = await fakeTraceB(state);
  const relay = await relayFor(traceB.origin);
  const mismatch = await relayFor(traceB.origin, { TRACE_CAMPUS_GRAPH_VERSION: "graph-0" });
  try {
    const [code, reason] = await once(browser(relay.port), "close");
    assert.equal(code, 4001);
    assert.equal(reason.toString(), "lease lost");

    const [mismatchCode] = await once(browser(mismatch.port), "close");
    assert.equal(mismatchCode, 4409);

    state.tokenStatus = 503;
    const [tokenCode] = await once(browser(relay.port), "close");
    assert.equal(tokenCode, 4503);
  } finally {
    traceB.server.close();
    relay.server.close();
    mismatch.server.close();
  }
});

test("refuses other origins and paths, and answers 503 without the display key", async () => {
  const state = { issued: 0, handshakes: [] };
  const traceB = await fakeTraceB(state);
  const relay = await relayFor(traceB.origin);
  const disabled = await relayFor(traceB.origin, { TRACE_DISPLAY_ISSUER_KEY: "" });
  try {
    const status = async (client) => (await once(client, "unexpected-response"))[1].statusCode;
    assert.equal(await status(browser(relay.port, { origin: "https://other.example.test" })), 403);
    assert.equal(await status(browser(relay.port, { path: "/elsewhere" })), 404);
    assert.equal(await status(browser(disabled.port)), 503);
    assert.equal(state.handshakes.length, 0);
  } finally {
    traceB.server.close();
    relay.server.close();
    disabled.server.close();
  }
});

test("needs all three versions and a key of its own to relay", () => {
  const base = { TRACE_API_ORIGIN: "https://api.example.test", TRACE_ARRIVAL_ISSUER_KEY: issuerKey, TRACE_DISPLAY_ISSUER_KEY: displayKey, ...versions };
  assert.equal(readConfig(base).versions.campusGraph, "graph-1");
  assert.throws(() => readConfig({ ...base, TRACE_THREE_D_MAP_VERSION: "" }));
  assert.throws(() => readConfig({ ...base, TRACE_DISPLAY_ISSUER_KEY: issuerKey }));
  assert.throws(() => readConfig({ ...base, TRACE_DISPLAY_ISSUER_KEY: "short" }));
  assert.equal(readConfig({ ...base, TRACE_DISPLAY_ISSUER_KEY: "" }).versions, null);
});
