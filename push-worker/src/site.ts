/** Same-origin API bridge for the static participant site. */
interface SiteEnv {
  ASSETS: Fetcher;
  TRACE_BACKEND_URL: string;
  TRACE_EDGE_SHARED_SECRET: string;
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

const MAX_JSON_BODY = 16 * 1024;
const allowed: Record<string, RegExp[]> = {
  GET: [/^health\/(live|ready)$/, /^v1\/public\/config$/, /^v1\/experiences\/exp_[A-Za-z0-9_-]+$/],
  POST: [/^v1\/experiences$/, /^v1\/live-presence-sessions\/live_[A-Za-z0-9_-]+\/(position|on-site|stop)$/],
  DELETE: [/^v1\/experiences\/exp_[A-Za-z0-9_-]+$/, /^v1\/memory-sessions\/mem_[A-Za-z0-9_-]+$/, /^v1\/live-presence-sessions\/live_[A-Za-z0-9_-]+$/],
};

function failure(code: string, status: number): Response {
  return Response.json({ error: { code } }, { status, headers: { "Cache-Control": "no-store" } });
}

async function limitedBody(request: Request): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_JSON_BODY) {
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

export async function handleSiteRequest(
  request: Request,
  env: SiteEnv,
  upstreamFetch: (request: Request) => Promise<Response> = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/backend/")) return env.ASSETS.fetch(request);
  if (url.search || url.hash) return failure("NOT_FOUND", 404);
  const path = url.pathname.slice("/api/backend/".length);
  if (!allowed[request.method]?.some((rule) => rule.test(path))) return failure("NOT_FOUND", 404);
  if (request.method !== "GET" && request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) {
    return failure("ORIGIN_NOT_ALLOWED", 403);
  }
  if (request.method === "POST" && !/^application\/json(?:\s*;|$)/i.test(request.headers.get("Content-Type") ?? "")) {
    return failure("UNSUPPORTED_MEDIA_TYPE", 415);
  }
  if (request.method === "DELETE" && request.body) return failure("BODY_NOT_ALLOWED", 400);
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

  const body = request.method === "POST" ? await limitedBody(request) : undefined;
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
