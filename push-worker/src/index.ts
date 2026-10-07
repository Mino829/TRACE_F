/**
 * TRACE push worker: keeps the phones that asked to be pinged, pings them on
 * the cron schedule in wrangler.jsonc, and stores the location (and the photo,
 * when there is one) each phone sends back.
 *
 * Storage:
 *   D1 `DB`      subscriptions, records (schema in migrations/)
 *   KV `LOG_KV`  photo:<record id> → JPEG bytes
 */

import { endOfDayJst, haversineMetres } from "./helpers";
import { sendPush, type PushSubscriptionJSON, type Vapid } from "./webpush";

interface Env {
  DB: D1Database;
  LOG_KV: KVNamespace;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_JWK: string;
  VAPID_SUBJECT: string;
  /** Comma-separated origins the web app is served from. */
  ALLOWED_ORIGINS: string;
}

type SubscriptionRow = { key: string; endpoint: string; p256dh: string; auth: string };

/** The parts of a record the worker reads; the rest is stored as sent. */
type Fix = { latitude: number; longitude: number; accuracy: number; altitude: number | null; altitudeAccuracy: number | null };
type IncomingRecord = {
  id: string;
  deviceId: string;
  kind: string;
  consentVersion: string;
  promptedAt: string | null;
  takenAt: string;
  capture?: { fixes?: Fix[]; coarse?: Fix | null };
  sourceGuess?: string | null;
  truth?: { wgs84?: { lat: number; lon: number }; level?: number; buildingIds?: string[]; confidence?: string } | null;
  network?: { type?: string } | null;
};

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;
const MAX_RECORD_BYTES = 512 * 1024;
/** A ping older than the next one is pointless, so the push service may drop it after ten minutes. */
const PING_TTL_SECONDS = 600;
const PING_BODY = "位置情報を記録してください。";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function vapid(env: Env): Vapid {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: env.VAPID_PRIVATE_JWK, subject: env.VAPID_SUBJECT };
}

async function subscriptionKey(endpoint: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isSubscription(value: unknown): value is PushSubscriptionJSON {
  const candidate = value as PushSubscriptionJSON | null;
  return typeof candidate?.endpoint === "string"
    && candidate.endpoint.startsWith("https://")
    && typeof candidate.keys?.p256dh === "string"
    && typeof candidate.keys?.auth === "string";
}

function text(value: unknown, max = 64): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((value) => value.trim());
  if (!allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
}

/** Sends one ping; a subscription the push service no longer knows is forgotten here too. */
async function ping(env: Env, row: SubscriptionRow, promptedAt: string): Promise<number> {
  const subscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
  const response = await sendPush(subscription, { title: "TRACE", body: PING_BODY, promptedAt }, vapid(env), PING_TTL_SECONDS);
  if (response.status === 404 || response.status === 410) await env.DB.prepare("DELETE FROM subscriptions WHERE key = ?").bind(row.key).run();
  return response.status;
}

/**
 * What Cloudflare knows about the connection. The network operator tells
 * campus Wi-Fi from a mobile carrier even on iPhones, which report no
 * connection type of their own. The IP address itself is not kept.
 */
function connectionSeen(request: Request) {
  const cf = request.cf as IncomingRequestCfProperties | undefined;
  return {
    asn: finite(cf?.asn),
    asOrganization: text(cf?.asOrganization, 128) || null,
    colo: text(cf?.colo, 8) || null,
    country: text(cf?.country, 8) || null,
    httpProtocol: text(cf?.httpProtocol, 16) || null,
    clientTcpRtt: finite(cf?.clientTcpRtt),
  };
}

async function handleRecord(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const form = await request.formData();
  const raw = form.get("record");
  if (typeof raw !== "string" || raw.length > MAX_RECORD_BYTES) return json({ error: "record is required" }, 400, cors);
  let record: IncomingRecord;
  try {
    record = JSON.parse(raw) as IncomingRecord;
  } catch {
    return json({ error: "record must be JSON" }, 400, cors);
  }
  if (!UUID.test(record.id ?? "") || Number.isNaN(Date.parse(record.takenAt ?? "")) || !text(record.consentVersion)) {
    return json({ error: "id, takenAt and consentVersion are required" }, 400, cors);
  }

  const photo = form.get("photo");
  let photoKey: string | null = null;
  if (photo instanceof File) {
    if (photo.type !== "image/jpeg" || photo.size === 0 || photo.size > MAX_PHOTO_BYTES) return json({ error: "photo must be a JPEG of at most 3MB" }, 400, cors);
    photoKey = `photo:${record.id}`;
    await env.LOG_KV.put(photoKey, await photo.arrayBuffer());
  }

  const fixes = Array.isArray(record.capture?.fixes) ? record.capture.fixes : [];
  const last = fixes.at(-1) ?? record.capture?.coarse ?? undefined;
  const truth = record.truth?.wgs84 && finite(record.truth.wgs84.lat) !== null && finite(record.truth.wgs84.lon) !== null ? record.truth : null;
  const errorM = last && truth?.wgs84 ? haversineMetres({ lat: last.latitude, lon: last.longitude }, truth.wgs84) : null;
  const receivedAt = new Date().toISOString();
  const seen = connectionSeen(request);
  const payload = JSON.stringify({ ...record, server: { receivedAt, connection: seen } });

  // A resend of a record already stored is acknowledged without a second row.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO records (id, device_id, kind, consent_version, prompted_at, taken_at, received_at, fix_count,
       latitude, longitude, accuracy, altitude, altitude_accuracy, source_guess,
       truth_latitude, truth_longitude, truth_level, truth_buildings, truth_confidence, error_m,
       photo_key, connection_type, asn, as_organization, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    record.id,
    text(record.deviceId) || "unknown",
    text(record.kind, 16) || "ping",
    text(record.consentVersion),
    text(record.promptedAt) || null,
    record.takenAt,
    receivedAt,
    fixes.length,
    finite(last?.latitude),
    finite(last?.longitude),
    finite(last?.accuracy),
    finite(last?.altitude),
    finite(last?.altitudeAccuracy),
    text(record.sourceGuess, 16) || null,
    truth?.wgs84?.lat ?? null,
    truth?.wgs84?.lon ?? null,
    finite(truth?.level),
    Array.isArray(truth?.buildingIds) ? truth.buildingIds.join(",").slice(0, 256) : null,
    text(truth?.confidence, 16) || null,
    errorM,
    photoKey,
    text(record.network?.type, 16) || null,
    seen.asn,
    seen.asOrganization,
    payload,
  ).run();
  return json({ ok: true }, 201, cors);
}

/** Withdrawal: everything this anonymous id sent, photos included, and its subscription. */
async function handleForget(deviceId: string, env: Env, cors: Record<string, string>): Promise<Response> {
  const { results } = await env.DB.prepare("SELECT photo_key FROM records WHERE device_id = ? AND photo_key IS NOT NULL").bind(deviceId).all<{ photo_key: string }>();
  await Promise.all(results.map((row) => env.LOG_KV.delete(row.photo_key)));
  const [records] = await env.DB.batch([
    env.DB.prepare("DELETE FROM records WHERE device_id = ?").bind(deviceId),
    env.DB.prepare("DELETE FROM subscriptions WHERE device_id = ?").bind(deviceId),
  ]);
  return json({ ok: true, deletedRecords: records.meta.changes }, 200, cors);
}

export default {
  async fetch(request, env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const { pathname } = new URL(request.url);

    try {
      if (request.method === "GET" && pathname === "/vapid-public-key") {
        return json({ publicKey: env.VAPID_PUBLIC_KEY }, 200, cors);
      }

      if (request.method === "POST" && pathname === "/subscribe") {
        const body = (await request.json()) as { subscription?: unknown; deviceId?: unknown; consentVersion?: unknown };
        if (!isSubscription(body.subscription)) return json({ error: "invalid subscription" }, 400, cors);
        if (!text(body.consentVersion)) return json({ error: "consentVersion is required" }, 400, cors);
        const now = Date.now();
        const expiresAt = endOfDayJst(now);
        const { endpoint, keys } = body.subscription;
        await env.DB.prepare(
          `INSERT OR REPLACE INTO subscriptions (key, endpoint, p256dh, auth, device_id, consent_version, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(await subscriptionKey(endpoint), endpoint, keys.p256dh, keys.auth, text(body.deviceId) || "unknown", text(body.consentVersion), new Date(now).toISOString(), expiresAt).run();
        return json({ ok: true, expiresAt }, 201, cors);
      }

      if (request.method === "POST" && pathname === "/unsubscribe") {
        const body = (await request.json()) as { endpoint?: unknown };
        if (typeof body.endpoint !== "string") return json({ error: "endpoint is required" }, 400, cors);
        await env.DB.prepare("DELETE FROM subscriptions WHERE key = ?").bind(await subscriptionKey(body.endpoint)).run();
        return json({ ok: true }, 200, cors);
      }

      // Only ever pings a subscription already stored here, so it cannot be aimed at arbitrary endpoints.
      if (request.method === "POST" && pathname === "/test") {
        const body = (await request.json()) as { endpoint?: unknown };
        if (typeof body.endpoint !== "string") return json({ error: "endpoint is required" }, 400, cors);
        const row = await env.DB.prepare("SELECT key, endpoint, p256dh, auth FROM subscriptions WHERE key = ? AND expires_at > ?")
          .bind(await subscriptionKey(body.endpoint), new Date().toISOString())
          .first<SubscriptionRow>();
        if (!row) return json({ error: "not subscribed" }, 404, cors);
        const status = await ping(env, row, new Date().toISOString());
        return json({ ok: status < 300, status }, status < 300 ? 200 : 502, cors);
      }

      if (request.method === "POST" && pathname === "/records") return await handleRecord(request, env, cors);

      if (request.method === "POST" && pathname === "/forget") {
        const body = (await request.json()) as { deviceId?: unknown };
        if (typeof body.deviceId !== "string" || !UUID.test(body.deviceId)) return json({ error: "deviceId is required" }, 400, cors);
        return await handleForget(body.deviceId, env, cors);
      }

      return json({ error: "not found" }, 404, cors);
    } catch (error) {
      console.error(error);
      return json({ error: "internal error" }, 500, cors);
    }
  },

  async scheduled(controller, env, ctx): Promise<void> {
    const promptedAt = new Date(controller.scheduledTime).toISOString();
    await env.DB.prepare("DELETE FROM subscriptions WHERE expires_at <= ?").bind(promptedAt).run();
    const { results } = await env.DB.prepare("SELECT key, endpoint, p256dh, auth FROM subscriptions").all<SubscriptionRow>();
    // Each ping is one outbound request: the free plan allows 50 per run, the paid plan 10,000.
    ctx.waitUntil(Promise.allSettled(results.map((row) => ping(env, row, promptedAt))));
  },
} satisfies ExportedHandler<Env>;
