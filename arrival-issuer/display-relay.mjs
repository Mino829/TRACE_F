// Relays /display's WebSocket to TRACE_B's /v1/display/ws without changing
// what flows through it: messages, pings and pongs pass as they are. The relay
// adds only what a browser must not hold or cannot send, the short-lived
// display token and the version headers (TRACE_B README, 描画WebSocket).
//
// Each browser connection gets its own TRACE_B connection, and either side
// closing closes the other. A closed or frozen /display therefore stops
// answering TRACE_B's pings, and TRACE_B settles its replay as skipped.
// Reconnecting, with backoff, is /display's job; every new connection here
// fetches a fresh display token.

import { STATUS_CODES } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { sign } from "./issuer-core.mjs";

export const DISPLAY_TOKEN_PATH = "/v1/operator/display-tokens";
export const RELAY_PATH = "/display-ws";
/** Messages /display may send before TRACE_B has answered; more means something is wrong. */
const MAX_QUEUED = 64;

/** Close codes that may be sent on as they are; 1005, 1006 and the like become 1011. */
function sendable(code) {
  return (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) || (code >= 3000 && code <= 4999);
}

export function createDisplayRelay(config, { fetch: fetchImpl = globalThis.fetch, now = Date.now, log = () => {} } = {}) {
  const server = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 1 << 20 });

  /** A fresh display token; it never leaves this process. */
  async function displayToken() {
    const timestamp = String(Math.floor(now() / 1000));
    const headers = {
      "X-Trace-Display-Issuer-Timestamp": timestamp,
      "X-Trace-Display-Issuer-Signature": sign(config.displayIssuerKey, "POST", DISPLAY_TOKEN_PATH, timestamp),
    };
    if (config.edgeSecret) headers["X-Trace-Edge-Secret"] = config.edgeSecret;
    const response = await fetchImpl(new URL(DISPLAY_TOKEN_PATH, config.origin), {
      method: "POST",
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw Object.assign(new Error(`表示用トークン: TRACE_B が ${response.status} を返しました`), { status: response.status });
    }
    const body = await response.json();
    if (typeof body?.displayToken !== "string" || !body.displayToken) throw new Error("表示用トークン: 応答に displayToken がありません");
    return body.displayToken;
  }

  function connect(browser) {
    const queue = [];
    let upstream = null;
    let browserClosed = false;
    const closeBrowser = (code, reason) => {
      if (browser.readyState === WebSocket.OPEN) browser.close(sendable(code) ? code : 1011, reason);
    };

    browser.on("message", (data, isBinary) => {
      if (upstream?.readyState === WebSocket.OPEN) return upstream.send(data, { binary: isBinary });
      if (queue.length >= MAX_QUEUED) return closeBrowser(1008, "too many messages before TRACE_B answered");
      queue.push([data, isBinary]);
    });
    browser.on("pong", (data) => {
      if (upstream?.readyState === WebSocket.OPEN) upstream.pong(data);
    });
    browser.on("close", () => {
      browserClosed = true;
      if (upstream?.readyState === WebSocket.OPEN) upstream.close(1000);
      else upstream?.terminate();
    });
    browser.on("error", () => {});

    displayToken().then((token) => {
      if (browserClosed) return;
      const url = new URL("/v1/display/ws", config.origin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const headers = {
        Authorization: `Bearer ${token}`,
        "X-Trace-Schema-Version": "1",
        "X-Trace-Coordinate-Version": config.versions.coordinate,
        "X-Trace-Campus-Graph-Version": config.versions.campusGraph,
        "X-Trace-Three-D-Map-Version": config.versions.threeDMap,
      };
      if (config.edgeSecret) headers["X-Trace-Edge-Secret"] = config.edgeSecret;
      // No Origin (TRACE_B refuses one) and no automatic pong: /display answers TRACE_B's pings itself.
      upstream = new WebSocket(url, { headers, autoPong: false, perMessageDeflate: false, followRedirects: false, handshakeTimeout: 8_000, maxPayload: 1 << 22 });
      upstream.on("open", () => {
        for (const [data, isBinary] of queue.splice(0)) upstream.send(data, { binary: isBinary });
        log("展示画面を TRACE_B につなぎました。");
      });
      upstream.on("message", (data, isBinary) => {
        if (browser.readyState === WebSocket.OPEN) browser.send(data, { binary: isBinary });
      });
      upstream.on("ping", (data) => {
        if (browser.readyState === WebSocket.OPEN) browser.ping(data);
      });
      // A refused handshake reaches /display as 4000 + the HTTP status (4401, 4409, 4503).
      upstream.on("unexpected-response", (request, response) => {
        log(`展示画面の接続を TRACE_B が ${response.statusCode} で断りました。`);
        closeBrowser(4000 + response.statusCode, `TRACE_B ${response.statusCode}`);
        response.resume();
        request.destroy();
      });
      upstream.on("close", (code, reason) => closeBrowser(code, reason));
      upstream.on("error", (error) => {
        log(`展示画面の接続: ${error.message}`);
        closeBrowser(1011, "TRACE_B unreachable");
      });
    }).catch((error) => {
      log(error.status ? error.message : `表示用トークンを取れませんでした: ${error.message}`);
      closeBrowser(error.status ? 4000 + error.status : 1011, error.status ? `TRACE_B ${error.status}` : "display token unavailable");
    });
  }

  /** The HTTP server's upgrade handler for /display-ws, with the same host and origin rules as /arrival-token. */
  function handleUpgrade(request, socket, head) {
    const reject = (status) => socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    const port = request.socket.localPort;
    if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) return reject(403);
    const origin = request.headers.origin;
    if (origin && !config.displayOrigins.includes(origin)) return reject(403);
    if (request.url !== RELAY_PATH) return reject(404);
    if (!config.displayIssuerKey) return reject(503);
    server.handleUpgrade(request, socket, head, connect);
  }

  return { handleUpgrade, displayToken };
}
