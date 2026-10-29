// Loopback-only broker. Google and opaque operator credentials are forwarded per request;
// the Edge secret never leaves this process. No QR or credential is cached here.
export const PROOF_PATH = "/v1/operator/arrival-proofs";
export const CREDENTIAL_PATH = "/v1/operator/credentials";
export const MIN_LEFT_MS = 5_000;

export function readConfig(env) {
  let url;
  try { url = new URL(env.TRACE_API_ORIGIN ?? ""); } catch {
    throw new Error("TRACE_API_ORIGIN に TRACE_B のオリジンを書いてください。");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("TRACE_API_ORIGIN は https のオリジンだけを書いてください（localhost のみ http 可）。");
  }
  const port = Number(env.ISSUER_PORT || 8790);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("ISSUER_PORT は 1024〜65535 の数にしてください。");
  const displayOrigins = (env.DISPLAY_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!displayOrigins.length) throw new Error("DISPLAY_ORIGINS に許可する /display のオリジンを書いてください。");
  for (const origin of displayOrigins) {
    let parsed;
    try { parsed = new URL(origin); } catch { parsed = null; }
    if (!parsed || parsed.origin !== origin || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)))) {
      throw new Error(`DISPLAY_ORIGINS の「${origin}」は許可できるオリジンではありません。`);
    }
  }
  return { origin: url.origin, edgeSecret: env.TRACE_EDGE_SHARED_SECRET ?? "", port, displayOrigins };
}

function send(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function singleHeader(request, name) {
  let count = 0;
  for (let i = 0; i < request.rawHeaders.length; i += 2) if (request.rawHeaders[i].toLowerCase() === name) count++;
  return count === 1 ? request.headers[name] : undefined;
}

export function createIssuer(config, { fetch: fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  async function handle(request, response) {
    const port = request.socket.localPort;
    const host = singleHeader(request, "host");
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(response, 403, { error: { code: "HOST_NOT_ALLOWED" } });
    const origin = singleHeader(request, "origin");
    if (!origin || !config.displayOrigins.includes(origin)) return send(response, 403, { error: { code: "ORIGIN_NOT_ALLOWED" } });
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    const routes = {
      "GET /arrival-token": ["POST", PROOF_PATH],
      "POST /operator/credentials": ["POST", CREDENTIAL_PATH],
      "DELETE /operator/credentials/current": ["DELETE", `${CREDENTIAL_PATH}/current`],
      "DELETE /operator/credentials": ["DELETE", CREDENTIAL_PATH],
    };
    if (request.method === "OPTIONS") {
      const method = singleHeader(request, "access-control-request-method");
      const headers = (request.headers["access-control-request-headers"] ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
      if (!routes[`${method} ${request.url}`] || headers.some((h) => h !== "authorization")) return send(response, 403, { error: { code: "PREFLIGHT_NOT_ALLOWED" } });
      response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE");
      response.setHeader("Access-Control-Allow-Headers", "Authorization");
      response.setHeader("Access-Control-Allow-Private-Network", "true");
      return send(response, 204);
    }
    if (request.method === "GET" && request.url === "/health") return send(response, 200, { ok: true });
    const route = routes[`${request.method} ${request.url}`];
    if (!route) return send(response, 404, { error: { code: "NOT_FOUND" } });
    const authorization = singleHeader(request, "authorization");
    if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) return send(response, 401, { error: { code: "UNAUTHORIZED" } });
    if (request.headers["transfer-encoding"] || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
      return send(response, 400, { error: { code: "INVALID_REQUEST" } });
    }
    try {
      const headers = { Authorization: authorization, Origin: origin };
      if (config.edgeSecret) headers["X-Trace-Edge-Secret"] = config.edgeSecret;
      const upstream = await fetchImpl(new URL(route[1], config.origin), { method: route[0], headers, redirect: "error", signal: AbortSignal.timeout(8_000) });
      if (!upstream.ok) {
        const body = await upstream.json().catch(() => null);
        const code = typeof body?.error?.code === "string" && /^[A-Z_]{1,80}$/.test(body.error.code) ? body.error.code : "UPSTREAM_ERROR";
        const retry = upstream.headers.get("Retry-After");
        if (retry && /^\d{1,6}$/.test(retry)) {
          response.setHeader("Retry-After", retry);
          response.setHeader("Access-Control-Expose-Headers", "Retry-After");
        }
        return send(response, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502, { error: { code } });
      }
      if (route[0] === "DELETE") {
        if (upstream.status !== 204) throw new Error("invalid revocation response");
        return send(response, 204);
      }
      const body = await upstream.json();
      const expiry = Date.parse(body?.expiresAt);
      if (!Number.isFinite(expiry) || expiry <= now()) throw new Error("invalid expiration");
      if (route[1] === PROOF_PATH) {
        if (typeof body.checkpointToken !== "string" || !body.checkpointToken || expiry - now() < MIN_LEFT_MS) throw new Error("invalid proof");
        return send(response, 200, { checkpointToken: body.checkpointToken, expiresAt: body.expiresAt });
      }
      if (typeof body.operatorToken !== "string" || !body.operatorToken || typeof body.credentialId !== "string" || !body.credentialId || body.role !== "operator") throw new Error("invalid credential");
      return send(response, 200, { operatorToken: body.operatorToken, credentialId: body.credentialId, expiresAt: body.expiresAt, role: "operator" });
    } catch {
      return send(response, 502, { error: { code: "BROKER_UPSTREAM_UNAVAILABLE" } });
    }
  }
  return { handle };
}
