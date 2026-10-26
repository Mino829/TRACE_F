/**
 * The booth's link to TRACE_B's display WebSocket (`/v1/display/ws`, TRACE_B
 * README「描画WebSocket」, issue #36).
 *
 * The browser does not hold the display credential: it connects to a relay on
 * the booth PC (Mino829/TRACE_F#46's arrival-issuer, ws://127.0.0.1:8790/display-ws),
 * which adds the credential and the version headers and passes frames through
 * unchanged. This file only speaks the frames:
 *
 * 1. on open, ask to be the primary renderer (`renderer.primary.acquire`);
 *    only the holder of the lease may replay. Another renderer holding it
 *    leaves this one on standby, asking again every few seconds;
 * 2. `display.snapshot` lists the arrivals still waiting (and replaces
 *    everything known, as after a gap); `arrival.replay.requested` adds one;
 *    `arrival.replay.skipped` takes one away, the one playing included;
 * 3. one arrival at a time: `arrival.replay.started`, the walk, then
 *    `arrival.replay.completed` (or `failed`), each with its own event id;
 * 4. `renderer.heartbeat` every 10 s keeps the lease; a dropped connection
 *    comes back with backoff, from a fresh snapshot.
 *
 * What to replay comes from `participant.arrived`. TRACE_B does not send the
 * visitor's route yet (TRACE_B#7); `route` is read when it does, as node ids
 * of campus_graph.json, and is null until then.
 */

export type LinkVersions = { coordinateVersion: string; campusGraphVersion: string; threeDMapVersion: string };

export type LinkState =
  /** Connecting, or waiting to reconnect. */
  | "connecting"
  /** Connected; another renderer holds the lease. */
  | "standby"
  /** Connected and the primary renderer: arrivals play here. */
  | "primary"
  /** The relay or TRACE_B refused this bundle's versions; reconnecting will not help. */
  | "rejected";

export type ArrivalToPlay = {
  arrivalId: string;
  /** How long TRACE_B gives the replay, when it says (participant.arrived's replayDurationSeconds). */
  durationSeconds: number | null;
  /** The visitor's route as graph node ids, once TRACE_B sends one; null until then. */
  route: string[] | null;
};

export type ReplayResult = "completed" | "failed";

export type LinkOptions = {
  url: string;
  versions: LinkVersions;
  /** Plays one arrival and resolves when it is over. Rejecting counts as failed. */
  replay: (arrival: ArrivalToPlay, signal: AbortSignal) => Promise<ReplayResult>;
  onState?: (state: LinkState) => void;
  /** For tests: the WebSocket constructor and the clock. */
  WebSocketImpl?: typeof WebSocket;
  newId?: () => string;
};

export type RendererLink = { close: () => void };

type Frame = { type?: unknown; eventId?: unknown; data?: unknown };

const HEARTBEAT_MS = 10_000;
const REACQUIRE_MS = 5_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A route TRACE_B may send with an arrival: an array of node ids, under `route` or `route.nodeIds`. */
function routeOf(data: Record<string, unknown>): string[] | null {
  const raw = Array.isArray(data.route) ? data.route : isRecord(data.route) && Array.isArray(data.route.nodeIds) ? data.route.nodeIds : null;
  if (!raw) return null;
  const ids = raw.filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids.length >= 2 ? ids : null;
}

export function connectRendererLink(options: LinkOptions): RendererLink {
  const Impl = options.WebSocketImpl ?? WebSocket;
  const newId = options.newId ?? (() => crypto.randomUUID());
  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let leaseId: string | null = null;
  let state: LinkState = "connecting";
  let heartbeat = 0;
  let reacquire = 0;
  let retry = 0;
  /** Arrivals waiting, in the order TRACE_B asked for them. */
  let queue: string[] = [];
  /** What participant.arrived said about each arrival. */
  const known = new Map<string, Omit<ArrivalToPlay, "arrivalId">>();
  let playing: { arrivalId: string; abort: AbortController } | null = null;
  const seen = new Set<string>();

  const setState = (next: LinkState) => {
    if (state === next) return;
    state = next;
    options.onState?.(next);
  };

  const send = (type: string, extra: Record<string, string> = {}) => {
    if (!socket || socket.readyState !== Impl.OPEN) return;
    socket.send(JSON.stringify({ schemaVersion: 1, type, ...options.versions, ...extra }));
  };

  const acquire = () => send("renderer.primary.acquire");

  const finish = (arrivalId: string, result: ReplayResult) => {
    if (leaseId) send(`arrival.replay.${result}`, { eventId: newId(), arrivalId, leaseId });
  };

  const next = () => {
    if (playing || !leaseId || queue.length === 0) return;
    const arrivalId = queue.shift()!;
    const meta = known.get(arrivalId) ?? { durationSeconds: null, route: null };
    const abort = new AbortController();
    playing = { arrivalId, abort };
    send("arrival.replay.started", { eventId: newId(), arrivalId, leaseId });
    options
      .replay({ arrivalId, ...meta }, abort.signal)
      .catch((): ReplayResult => "failed")
      .then((result) => {
        if (playing?.arrivalId !== arrivalId) return;
        playing = null;
        known.delete(arrivalId);
        // A replay cut short by a skip or a lost lease is not reported: TRACE_B already settled it.
        if (!abort.signal.aborted) finish(arrivalId, result);
        next();
      });
  };

  const stopPlaying = () => {
    playing?.abort.abort();
    playing = null;
  };

  const onFrame = (frame: Frame) => {
    const type = str(frame.type);
    const data = isRecord(frame.data) ? frame.data : {};
    if (!type) return;
    // Durable events are numbered; a repeat after a reconnect is dropped. Snapshots always apply.
    const eventId = str(frame.eventId);
    if (eventId && type !== "display.snapshot") {
      if (seen.has(`${type}:${eventId}`)) return;
      seen.add(`${type}:${eventId}`);
    }
    switch (type) {
      case "display.snapshot": {
        // The snapshot replaces what was known: arrivals still waiting, in order.
        const arrivals = Array.isArray(data.arrivals) ? data.arrivals.filter(isRecord) : [];
        // "playing" ones were this renderer's before a reconnect; TRACE_B settles those itself.
        const waiting = arrivals.filter((a) => str(a.replayStatus) === "queued").flatMap((a) => str(a.arrivalId) ?? []);
        if (playing && !arrivals.some((a) => str(a.arrivalId) === playing!.arrivalId)) stopPlaying();
        queue = waiting.filter((id) => id !== playing?.arrivalId);
        next();
        break;
      }
      case "participant.arrived": {
        const arrivalId = str(data.arrivalId);
        if (!arrivalId) break;
        const seconds = typeof data.replayDurationSeconds === "number" && data.replayDurationSeconds > 0 ? data.replayDurationSeconds : null;
        known.set(arrivalId, { durationSeconds: seconds, route: routeOf(data) });
        break;
      }
      case "arrival.replay.requested": {
        const arrivalId = str(data.arrivalId);
        if (arrivalId && arrivalId !== playing?.arrivalId && !queue.includes(arrivalId)) queue.push(arrivalId);
        next();
        break;
      }
      case "arrival.replay.skipped": {
        const arrivalId = str(data.arrivalId);
        queue = queue.filter((id) => id !== arrivalId);
        if (arrivalId && playing?.arrivalId === arrivalId) stopPlaying();
        break;
      }
      case "renderer.primary.granted": {
        leaseId = str(data.leaseId);
        if (leaseId) {
          window.clearInterval(reacquire);
          setState("primary");
          next();
        }
        break;
      }
      case "renderer.primary.conflict": {
        setState("standby");
        window.clearInterval(reacquire);
        reacquire = window.setInterval(acquire, REACQUIRE_MS);
        break;
      }
      case "renderer.primary.lost": {
        leaseId = null;
        stopPlaying();
        setState("standby");
        acquire();
        break;
      }
      case "renderer.version.rejected": {
        setState("rejected");
        break;
      }
      // renderer.ack / renderer.rejected: a replay report that TRACE_B took or refused; nothing to redo here.
    }
  };

  const open = () => {
    if (closed) return;
    setState("connecting");
    const ws = new Impl(options.url);
    socket = ws;
    ws.onopen = () => {
      attempt = 0;
      acquire();
      window.clearInterval(heartbeat);
      heartbeat = window.setInterval(() => send("renderer.heartbeat", leaseId ? { leaseId } : {}), HEARTBEAT_MS);
    };
    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      try {
        onFrame(JSON.parse(event.data) as Frame);
      } catch (error) {
        console.error("display link: a frame could not be read", error);
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      leaseId = null;
      stopPlaying();
      window.clearInterval(heartbeat);
      window.clearInterval(reacquire);
      if (closed || state === "rejected") return;
      setState("connecting");
      retry = window.setTimeout(open, BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
      attempt += 1;
    };
  };

  open();
  return {
    close() {
      closed = true;
      window.clearInterval(heartbeat);
      window.clearInterval(reacquire);
      window.clearTimeout(retry);
      stopPlaying();
      socket?.close();
      socket = null;
    },
  };
}
