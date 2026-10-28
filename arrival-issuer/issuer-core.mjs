// Gets arrival QR tokens from TRACE_B for the booth and hands the current one
// to /display on the same PC. The issuer key stays in this process: /display
// only ever sees the token it projects, which TRACE_B made public on purpose.

import { createHmac } from "node:crypto";

export const PROOF_PATH = "/v1/operator/arrival-proofs";
/** A token handed out has at least this long left, so a phone can still read and send it. */
export const MIN_LEFT_MS = 5_000;

/** TRACE_B's operator signature (TRACE_B README): base64url HMAC-SHA256 of "METHOD\nPATH\nUNIX_SECONDS", unpadded. */
export function sign(key, method, path, timestamp) {
  return createHmac("sha256", key).update(`${method}\n${path}\n${timestamp}`).digest("base64url");
}

/** Reads the settings from the environment (arrival-issuer/.env), with messages for the person setting up the PC. */
export function readConfig(env) {
  let url;
  try {
    url = new URL(env.TRACE_API_ORIGIN ?? "");
  } catch {
    throw new Error("TRACE_API_ORIGIN に TRACE_B のオリジン（https://...）を書いてください。");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("TRACE_API_ORIGIN は https のオリジンだけを書いてください（パスや ? は付けません）。");
  }
  const issuerKey = env.TRACE_ARRIVAL_ISSUER_KEY ?? "";
  if (issuerKey.length < 32) {
    throw new Error("TRACE_ARRIVAL_ISSUER_KEY に、TRACE_B と同じ32文字以上の値を書いてください。");
  }
  const port = Number(env.ISSUER_PORT || 8790);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("ISSUER_PORT は 1024〜65535 の数にしてください。");
  }
  const displayOrigins = (env.DISPLAY_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  for (const origin of displayOrigins) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.origin !== origin) {
      throw new Error(`DISPLAY_ORIGINS の「${origin}」はオリジンではありません（例: https://trace-log.async5855.workers.dev）。`);
    }
  }
  const refreshSeconds = Number(env.REFRESH_SECONDS || 15);
  // TRACE_B's token lives 25 s; a refresh slower than 20 s would leave the screen without one.
  if (!(refreshSeconds >= 5 && refreshSeconds <= 20)) {
    throw new Error("REFRESH_SECONDS は 5〜20 にしてください。");
  }
  // The display relay is optional: without its key, /display-ws answers 503.
  const displayIssuerKey = env.TRACE_DISPLAY_ISSUER_KEY ?? "";
  let versions = null;
  if (displayIssuerKey) {
    if (displayIssuerKey.length < 32 || displayIssuerKey === issuerKey) {
      throw new Error("TRACE_DISPLAY_ISSUER_KEY に、TRACE_B と同じ32文字以上の値を書いてください（到着用の鍵とは別の値です）。");
    }
    versions = {
      coordinate: env.TRACE_COORDINATE_VERSION ?? "",
      campusGraph: env.TRACE_CAMPUS_GRAPH_VERSION ?? "",
      threeDMap: env.TRACE_THREE_D_MAP_VERSION ?? "",
    };
    if (Object.values(versions).some((value) => !value || /\s/.test(value))) {
      throw new Error("展示画面の中継には TRACE_COORDINATE_VERSION、TRACE_CAMPUS_GRAPH_VERSION、TRACE_THREE_D_MAP_VERSION が要ります。TRACE_B の設定と同じ値を書いてください。");
    }
  }
  return {
    origin: url.origin,
    issuerKey,
    edgeSecret: env.TRACE_EDGE_SHARED_SECRET ?? "",
    port,
    displayOrigins,
    refreshMs: refreshSeconds * 1000,
    displayIssuerKey,
    versions,
  };
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

export function createIssuer(config, { fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  let latest = null;
  let nextAt = 0;
  let lastSuccessAt = 0;
  let lastError = "";

  /** Asks TRACE_B for a fresh token; returns how long to wait before the next ask. */
  async function refresh() {
    const timestamp = String(Math.floor(now() / 1000));
    const headers = {
      "X-Trace-Issuer-Timestamp": timestamp,
      "X-Trace-Issuer-Signature": sign(config.issuerKey, "POST", PROOF_PATH, timestamp),
    };
    if (config.edgeSecret) headers["X-Trace-Edge-Secret"] = config.edgeSecret;
    let wait = config.refreshMs;
    try {
      // No body and no Origin: TRACE_B refuses either on this route.
      const response = await fetchImpl(new URL(PROOF_PATH, config.origin), {
        method: "POST",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        if (response.status === 429 && retryAfter > 0) wait = Math.max(wait, retryAfter * 1000);
        const code = await response.json().then((body) => body?.error?.code).catch(() => undefined);
        throw new Error(`TRACE_B が ${response.status}${code ? ` ${code}` : ""} を返しました`);
      }
      const body = await response.json();
      const expiresAt = Date.parse(body?.expiresAt);
      if (typeof body?.checkpointToken !== "string" || !body.checkpointToken || !Number.isFinite(expiresAt)) {
        throw new Error("TRACE_B の応答に checkpointToken と expiresAt がありません");
      }
      latest = { checkpointToken: body.checkpointToken, expiresAt };
      lastSuccessAt = now();
      lastError = "";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    nextAt = now() + wait;
    return wait;
  }

  /** The token to project now, or null once the last one is too close to expiring. */
  function current() {
    return latest && latest.expiresAt - now() >= MIN_LEFT_MS ? latest : null;
  }

  function status() {
    return {
      ok: Boolean(current()),
      lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
      lastError,
    };
  }

  /** The local HTTP side: only /display in a browser on this PC, or curl, reads it. */
  function handle(request, response) {
    const port = request.socket.localPort;
    // Refuses other host names pointed at 127.0.0.1 (DNS rebinding).
    if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) {
      return send(response, 403, { error: "HOST_NOT_ALLOWED" });
    }
    const origin = request.headers.origin;
    if (origin) {
      if (!config.displayOrigins.includes(origin)) return send(response, 403, { error: "ORIGIN_NOT_ALLOWED" });
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET");
      response.setHeader("Access-Control-Allow-Private-Network", "true");
      return send(response, 204);
    }
    if (request.method !== "GET") return send(response, 405, { error: "METHOD_NOT_ALLOWED" });
    if (request.url === "/arrival-token") {
      const token = current();
      if (!token) return send(response, 503, { error: "NO_TOKEN" });
      return send(response, 200, {
        checkpointToken: token.checkpointToken,
        expiresAt: new Date(token.expiresAt).toISOString(),
        nextAt: new Date(nextAt).toISOString(),
      });
    }
    if (request.url === "/health") return send(response, 200, status());
    return send(response, 404, { error: "NOT_FOUND" });
  }

  return { refresh, current, status, handle };
}
