/** Same-origin API bridges for the static participant site and opt-in operator display. */
interface SiteEnv {
  ASSETS: Fetcher;
  TRACE_BACKEND_URL: string;
  TRACE_EDGE_SHARED_SECRET: string;
  TRACE_OPERATOR_ALLOWED_ORIGIN?: string;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

const MAX_JSON_BODY = 16 * 1024;
/**
 * The participant routes of TRACE_B (internal/api/server.go). Operator and display routes stay closed here.
 * New photo bytes never leave the phone; /v2 relays metadata and private stories.
 * Legacy /v1 photo reads/deletes and Live state/stop/delete remain available to their
 * owners until deleteAfter. Legacy uploads and all new GPS writes stay blocked.
 */
const allowed: Record<string, RegExp[]> = {
  GET: [
    /^health\/(live|ready)$/,
    /^v1\/public\/config$/,
    /^v1\/experiences\/exp_[A-Za-z0-9_-]+$/,
    /^v1\/live-presence-sessions\/live_[A-Za-z0-9_-]+$/,
    /^v1\/memory-sessions\/mem_[A-Za-z0-9_-]+\/(photos|memory)$/,
    /^v2\/memory-sessions\/mem_[A-Za-z0-9_-]+\/(photos|memory)$/,
  ],
  POST: [
    /^v1\/experiences$/,
    /^v1\/live-presence-sessions\/live_[A-Za-z0-9_-]+\/(on-site|stop)$/,
    /^v1\/memory-sessions\/mem_[A-Za-z0-9_-]+\/(arrival|arrival\/skip|stop)$/,
    /^v2\/memory-sessions\/mem_[A-Za-z0-9_-]+\/photos$/,
  ],
  PUT: [/^v1\/memory-sessions\/mem_[A-Za-z0-9_-]+\/push-subscription$/],
  PATCH: [/^v1\/memory-sessions\/mem_[A-Za-z0-9_-]+\/push-subscription$/],
  DELETE: [
    /^v1\/experiences\/exp_[A-Za-z0-9_-]+$/,
    /^v1\/memory-sessions\/mem_[A-Za-z0-9_-]+$/,
    /^v1\/memory-sessions\/mem_[A-Za-z0-9_-]+\/(photos\/photo_[A-Za-z0-9_-]+|push-subscription)$/,
    /^v1\/live-presence-sessions\/live_[A-Za-z0-9_-]+$/,
    /^v2\/memory-sessions\/mem_[A-Za-z0-9_-]+\/photos\/photo_[A-Za-z0-9_-]+$/,
  ],
};
/** Methods whose body is relayed. Each must say it is JSON, even when the body is empty (arrival/skip). */
const WITH_BODY = new Set(["POST", "PUT", "PATCH"]);

function failure(code: string, status: number): Response {
  return Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function limitedBody(request: Request | Response, maxBytes = MAX_JSON_BODY): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new ArrayBuffer(length);
  const body = new Uint8Array(buffer);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}

/** Accept only canonical, unambiguous addresses supplied by the Cloudflare edge. */
function canonicalClientIP(value: string | null): string | null {
  if (!value) return null;
  if (value.includes(":")) {
    try {
      return new URL(`http://[${value}]/`).hostname === `[${value}]` ? value : null;
    } catch {
      return null;
    }
  }
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(?:0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255)) {
    return null;
  }
  return value;
}

// Deliberately not a general operator proxy: display-token and WebSocket access
// remain direct, authenticated Go endpoints; administrative routes stay closed.
const operatorRoutes: Record<string, readonly [string, string]> = {
  "POST /api/operator/operator/credentials": ["POST", "/v1/operator/credentials"],
  "GET /api/operator/arrival-token": ["POST", "/v1/operator/arrival-proofs"],
  "DELETE /api/operator/operator/credentials/current": ["DELETE", "/v1/operator/credentials/current"],
  "DELETE /api/operator/operator/credentials": ["DELETE", "/v1/operator/credentials"],
};

async function handleOperatorRequest(
  request: Request,
  url: URL,
  env: SiteEnv,
  upstreamFetch: (request: Request) => Promise<Response>,
): Promise<Response> {
  // The binding is an exact HTTPS origin, never a URL prefix or a default.
  if (url.protocol !== "https:" || env.TRACE_OPERATOR_ALLOWED_ORIGIN !== url.origin) {
    return failure("NOT_FOUND", 404);
  }
  const route = operatorRoutes[`${request.method} ${url.pathname}`];
  if (!route || request.url.includes("?") || request.url.includes("#")) return failure("NOT_FOUND", 404);
  const origin = request.headers.get("Origin");
  if (origin !== url.origin && !(request.method === "GET" && origin === null && request.headers.get("Sec-Fetch-Site") === "same-origin")) {
    return failure("ORIGIN_NOT_ALLOWED", 403);
  }
  const authorization = request.headers.get("Authorization");
  // Headers combines duplicate values with commas, which this grammar rejects.
  // Syntax validation is not authentication: Go validates every Google/opaque token.
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) return failure("UNAUTHORIZED", 401);
  const contentLength = request.headers.get("Content-Length");
  if (request.headers.has("Transfer-Encoding") || (contentLength !== null && contentLength !== "0")) {
    return failure("BODY_NOT_ALLOWED", 400);
  }
  try {
    if (await limitedBody(request, 0) === null) return failure("BODY_NOT_ALLOWED", 400);
  } catch {
    return failure("INVALID_REQUEST", 400);
  }
  let backend: URL;
  let headers: Headers;
  try {
    backend = new URL(env.TRACE_BACKEND_URL);
    if (backend.protocol !== "https:" ||
        (env.TRACE_BACKEND_URL !== backend.origin && env.TRACE_BACKEND_URL !== `${backend.origin}/`) ||
        !env.TRACE_EDGE_SHARED_SECRET) {
      return failure("BACKEND_UNAVAILABLE", 503);
    }
    headers = new Headers({
      Authorization: authorization,
      Origin: url.origin,
      "X-Trace-Edge-Secret": env.TRACE_EDGE_SHARED_SECRET,
    });
  } catch {
    return failure("BACKEND_UNAVAILABLE", 503);
  }
  const clientIP = canonicalClientIP(request.headers.get("CF-Connecting-IP"));
  if (clientIP) headers.set("X-Trace-Client-IP", clientIP);
  try {
    const upstream = await upstreamFetch(new Request(new URL(route[1], backend), {
      method: route[0],
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    }));
    if (upstream.status >= 300 && upstream.status < 400) throw new Error("upstream redirect");
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (upstream.status >= 400 && upstream.status < 600) {
      let code = "UPSTREAM_ERROR";
      try {
        const bytes = await limitedBody(upstream);
        const body = bytes === null ? null : JSON.parse(new TextDecoder().decode(bytes));
        if (typeof body?.error?.code === "string" && /^[A-Z_]{1,80}$/.test(body.error.code)) code = body.error.code;
      } catch {
        // Never expose upstream text, credential details or private headers.
      }
      const retry = upstream.headers.get("Retry-After");
      if (retry && /^\d{1,6}$/.test(retry)) responseHeaders.set("Retry-After", retry);
      return Response.json({ error: { code } }, { status: upstream.status, headers: responseHeaders });
    }
    if (route[0] === "DELETE") {
      if (upstream.status !== 204) throw new Error("invalid revocation response");
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    if (upstream.status !== 200) throw new Error("invalid issuance response");
    const bytes = await limitedBody(upstream);
    if (bytes === null) throw new Error("upstream body too large");
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const expiry = typeof body?.expiresAt === "string" ? Date.parse(body.expiresAt) : NaN;
    const now = Date.now();
    if (!Number.isFinite(expiry) || expiry <= now) throw new Error("invalid expiration");
    if (route[1] === "/v1/operator/arrival-proofs") {
      if (typeof body.checkpointToken !== "string" || !body.checkpointToken || expiry - now < 5000) {
        throw new Error("invalid proof");
      }
      return Response.json({ checkpointToken: body.checkpointToken, expiresAt: body.expiresAt }, { headers: responseHeaders });
    }
    if (typeof body.operatorToken !== "string" || !body.operatorToken ||
        typeof body.credentialId !== "string" || !body.credentialId || body.role !== "operator") {
      throw new Error("invalid credential");
    }
    return Response.json({
      operatorToken: body.operatorToken, credentialId: body.credentialId, expiresAt: body.expiresAt, role: "operator",
    }, { headers: responseHeaders });
  } catch {
    return failure("BROKER_UPSTREAM_UNAVAILABLE", 502);
  }
}

export async function handleSiteRequest(
  request: Request,
  env: SiteEnv,
  upstreamFetch: (request: Request) => Promise<Response> = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/operator" || url.pathname.startsWith("/api/operator/")) {
    return handleOperatorRequest(request, url, env, upstreamFetch);
  }
  if (!url.pathname.startsWith("/api/backend/")) return env.ASSETS.fetch(request);
  if (url.search || url.hash) return failure("NOT_FOUND", 404);
  const path = url.pathname.slice("/api/backend/".length);
  if (!allowed[request.method]?.some((rule) => rule.test(path))) return failure("NOT_FOUND", 404);
  if (request.method !== "GET" && request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) {
    return failure("ORIGIN_NOT_ALLOWED", 403);
  }
  if (WITH_BODY.has(request.method) && !/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
    return failure("UNSUPPORTED_MEDIA_TYPE", 415);
  }
  // Cloudflare can expose a stream even for a bodyless DELETE; inspect bytes,
  // cancelling at the first nonempty chunk instead of trusting stream presence.
  if (request.method === "DELETE" && await limitedBody(request, 0) === null) return failure("BODY_NOT_ALLOWED", 400);
  if (!env.TRACE_BACKEND_URL || !env.TRACE_EDGE_SHARED_SECRET) return failure("BACKEND_UNAVAILABLE", 503);

  let backend: URL;
  try {
    backend = new URL(env.TRACE_BACKEND_URL);
    if (backend.protocol !== "https:" || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) {
      throw new Error("invalid backend URL");
    }
  } catch {
    return failure("BACKEND_UNAVAILABLE", 503);
  }

  const body = WITH_BODY.has(request.method) ? await limitedBody(request) : undefined;
  if (body === null) return failure("BODY_TOO_LARGE", 413);
  const headers = new Headers({ "X-Trace-Edge-Secret": env.TRACE_EDGE_SHARED_SECRET });
  for (const name of ["Authorization", "Content-Type", "Idempotency-Key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (request.method === "DELETE" && /^v1\/experiences\/exp_[A-Za-z0-9_-]+$/.test(path)) {
    const liveToken = request.headers.get("X-Trace-Live-Token");
    if (liveToken) headers.set("X-Trace-Live-Token", liveToken);
  }
  const clientIP = canonicalClientIP(request.headers.get("CF-Connecting-IP"));
  if (clientIP) headers.set("X-Trace-Client-IP", clientIP);
  try {
    const response = await upstreamFetch(new Request(new URL(`/${path}`, backend), {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    }));
    if (response.status >= 300 && response.status < 400) return failure("BACKEND_UNAVAILABLE", 503);
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["Content-Type", "X-Request-ID", "Retry-After"]) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.status === 204 ? null : response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return failure("BACKEND_UNAVAILABLE", 503);
  }
}

export default {
  fetch(request: Request, env: SiteEnv) {
    return handleSiteRequest(request, env);
  },
} satisfies ExportedHandler<SiteEnv>;
