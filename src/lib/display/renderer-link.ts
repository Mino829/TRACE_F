/**
 * The booth's link to TRACE_B's display WebSocket (issue #36), as designed in
 * trace-campus-installation#32 and built in TRACE_B#37.
 *
 * The booth browser connects to TRACE_B directly; nothing relays it:
 *
 * 1. the operator signs in with Google on the booth page. The Google ID token
 *    stays in memory and buys a short display credential (two minutes) from
 *    `POST /v1/operator/display-tokens`;
 * 2. the WebSocket's first message is `renderer.authenticate` with that
 *    credential and this bundle's three versions. The first
 *    `display.snapshot` is the sign that it was accepted; close 4401 means
 *    the credential was not (a fresh one is fetched), 4409 that the versions
 *    differ (no point retrying);
 * 3. the page asks to be the primary renderer. Only the lease holder plays;
 *    another booth holding it leaves this one on standby;
 * 4. arrivals wait in the order TRACE_B gives (snapshot, then
 *    `arrival.replay.requested`). For each, `arrival.replay.started` is a
 *    request: the walk begins only on TRACE_B's `renderer.ack`, and a
 *    `renderer.rejected` drops that arrival. When the walk ends,
 *    `arrival.replay.completed` goes out, the arrived card holds the booth for
 *    a few seconds (QR hidden, nothing new starts), then the next arrival or
 *    the top screen (trace-campus-installation#31);
 * 5. `renderer.heartbeat` every 10 s keeps the lease. A dropped connection
 *    comes back with backoff, with a new credential, from a fresh snapshot.
 *
 * An arrival's route is `pathNodeIds`, node ids of campus_graph.json from the
 * first photo to ShibaLab, with `photoCheckpoints` in shooting order. An empty
 * route (no photos, an old photo, another graph version) is played as the
 * arrived card alone.
 */

export type LinkVersions = { coordinateVersion: string; campusGraphVersion: string; threeDMapVersion: string };

export type LinkState =
  /** Waiting for the operator to sign in with Google (or to sign in again). */
  | "login"
  /** Getting a credential, connecting, or waiting to reconnect. */
  | "connecting"
  /** Connected; another booth holds the lease. */
  | "standby"
  /** Connected and the primary renderer: arrivals play here. */
  | "primary"
  /** TRACE_B refused this booth for good: other versions, or a page origin it does not allow. */
  | "rejected";

export type PhotoCheckpoint = { checkpointId: string; capturedAt: string };

export type ArrivalToPlay = {
  arrivalId: string;
  /** The visitor's route as graph node ids, ending at ShibaLab; empty when there is nothing to walk. */
  pathNodeIds: string[];
  photoCheckpoints: PhotoCheckpoint[];
  /** How long TRACE_B gives the replay (replayDurationSeconds), when it says. */
  durationSeconds: number | null;
};

export type ReplayResult = "completed" | "failed";

export type LinkOptions = {
  /** TRACE_B's origin, e.g. https://trace-backend-….run.app. */
  apiUrl: string;
  versions: LinkVersions;
  /** The Google ID token the operator signed in with, or null when there is none (yet, or any more). */
  idToken: () => string | null;
  /** Plays one arrival and resolves when its walk is over. Rejecting counts as failed. */
  replay: (arrival: ArrivalToPlay, signal: AbortSignal) => Promise<ReplayResult>;
  /** After an arrival's card, when nothing else is waiting: the booth goes back to its QR. */
  onIdle?: () => void;
  onState?: (state: LinkState, detail?: string) => void;
  /** How long the arrived card holds the booth before the next arrival (ARRIVED_SECONDS on the page). */
  holdMs?: number;
  /** For tests. */
  WebSocketImpl?: typeof WebSocket;
  fetchImpl?: typeof fetch;
  newId?: () => string;
};

export type RendererLink = {
  /** Call once the operator has signed in (again): connects if it was waiting for that. */
  signedIn: () => void;
  close: () => void;
};

type Frame = { type?: unknown; eventId?: unknown; data?: unknown };
type Known = Omit<ArrivalToPlay, "arrivalId">;

const HEARTBEAT_MS = 10_000;
const REACQUIRE_MS = 5_000;
const ACK_TIMEOUT_MS = 10_000;
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
/** Close codes TRACE_B uses after the handshake (TRACE_B#37 internal/api/display.go). */
const CLOSE_UNAUTHENTICATED = 4401;
const CLOSE_VERSION_MISMATCH = 4409;
const CLOSE_TOO_BIG = 1009;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The route and photos of an arrival, from participant.arrived, a snapshot entry or photo.moment.*. */
function routeOf(data: Record<string, unknown>): Pick<Known, "pathNodeIds" | "photoCheckpoints"> {
  const pathNodeIds = Array.isArray(data.pathNodeIds) ? data.pathNodeIds.flatMap((id) => str(id) ?? []) : [];
  const photoCheckpoints = Array.isArray(data.photoCheckpoints)
    ? data.photoCheckpoints.filter(isRecord).flatMap((p) => {
        const checkpointId = str(p.checkpointId);
        return checkpointId ? [{ checkpointId, capturedAt: str(p.capturedAt) ?? "" }] : [];
      })
    : [];
  return { pathNodeIds: pathNodeIds.length >= 2 ? pathNodeIds : [], photoCheckpoints };
}

function durationOf(data: Record<string, unknown>): number | null {
  return typeof data.replayDurationSeconds === "number" && data.replayDurationSeconds > 0 ? data.replayDurationSeconds : null;
}

export function connectRendererLink(options: LinkOptions): RendererLink {
  const Impl = options.WebSocketImpl ?? WebSocket;
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const newId = options.newId ?? (() => crypto.randomUUID());
  const holdMs = options.holdMs ?? 4_000;
  const api = options.apiUrl.replace(/\/+$/, "");
  const wsUrl = `${api.replace(/^http/, "ws")}/v1/display/ws`;

  let socket: WebSocket | null = null;
  let closed = false;
  let waitingForLogin = false;
  let attempt = 0;
  let unauthorizedInRow = 0;
  let authenticated = false;
  let leaseId: string | null = null;
  let state: LinkState = "connecting";
  let heartbeat = 0;
  let reacquire = 0;
  let retry = 0;
  let hold = 0;
  let ackTimer = 0;
  /** Arrivals waiting, in the order TRACE_B asked for them. */
  let queue: string[] = [];
  const known = new Map<string, Known>();
  /** A start request waiting for TRACE_B's answer. */
  let starting: { arrivalId: string; eventId: string } | null = null;
  let playing: { arrivalId: string; abort: AbortController } | null = null;
  /** The arrived card is up: nothing new starts until it has been shown. */
  let holding = false;
  const seen = new Set<string>();

  const setState = (next: LinkState, detail?: string) => {
    if (state === next && !detail) return;
    state = next;
    options.onState?.(next, detail);
  };

  const send = (type: string, extra: Record<string, unknown> = {}) => {
    if (!socket || socket.readyState !== Impl.OPEN) return;
    socket.send(JSON.stringify({ schemaVersion: 1, type, ...options.versions, ...extra }));
  };

  const acquire = () => send("renderer.primary.acquire");

  const busy = () => Boolean(starting || playing || holding);

  /** Asks TRACE_B to start the oldest waiting arrival; the walk waits for its ack. */
  const next = () => {
    if (busy() || !leaseId || !authenticated) return;
    const arrivalId = queue.shift();
    if (!arrivalId) return;
    const eventId = newId();
    starting = { arrivalId, eventId };
    send("arrival.replay.started", { eventId, arrivalId, leaseId });
    window.clearTimeout(ackTimer);
    ackTimer = window.setTimeout(() => {
      // No answer: leave it to TRACE_B (its own timeouts settle the arrival) and move on.
      if (starting?.eventId !== eventId) return;
      starting = null;
      next();
    }, ACK_TIMEOUT_MS);
  };

  const play = (arrivalId: string) => {
    const meta = known.get(arrivalId) ?? { pathNodeIds: [], photoCheckpoints: [], durationSeconds: null };
    const abort = new AbortController();
    playing = { arrivalId, abort };
    options
      .replay({ arrivalId, ...meta }, abort.signal)
      .catch((): ReplayResult => "failed")
      .then((result) => {
        if (playing?.arrivalId !== arrivalId) return;
        playing = null;
        known.delete(arrivalId);
        // Cut short by a skip or a lost lease: TRACE_B has settled it already.
        if (abort.signal.aborted || !leaseId) return next();
        send(`arrival.replay.${result}`, { eventId: newId(), arrivalId, leaseId });
        if (result === "failed") return next();
        // The arrived card holds the booth; then the next visitor, or the QR again.
        holding = true;
        window.clearTimeout(hold);
        hold = window.setTimeout(() => {
          holding = false;
          if (queue.length > 0 && leaseId) next();
          else options.onIdle?.();
        }, holdMs);
      });
  };

  const stopPlaying = () => {
    playing?.abort.abort();
    playing = null;
    starting = null;
    window.clearTimeout(ackTimer);
  };

  const remember = (arrivalId: string, data: Record<string, unknown>) => {
    const prior = known.get(arrivalId);
    known.set(arrivalId, { ...routeOf(data), durationSeconds: durationOf(data) ?? prior?.durationSeconds ?? null });
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
        // The first snapshot is the sign the credential was taken; each one replaces what was known.
        const first = !authenticated;
        authenticated = true;
        unauthorizedInRow = 0;
        attempt = 0;
        const arrivals = Array.isArray(data.arrivals) ? data.arrivals.filter(isRecord) : [];
        for (const a of arrivals) {
          const id = str(a.arrivalId);
          if (id) remember(id, a);
        }
        // "playing" ones were this booth's before a reconnect; TRACE_B settles those itself.
        const waiting = arrivals.filter((a) => str(a.replayStatus) === "queued").flatMap((a) => str(a.arrivalId) ?? []);
        if (playing && !arrivals.some((a) => str(a.arrivalId) === playing!.arrivalId)) stopPlaying();
        queue = waiting.filter((id) => id !== playing?.arrivalId && id !== starting?.arrivalId);
        if (first) acquire();
        next();
        break;
      }
      case "participant.arrived":
      case "photo.moment.created":
      case "photo.moment.deleted": {
        // A photo added or deleted before the replay replaces the whole route; one already walking keeps its own.
        const arrivalId = str(data.arrivalId);
        if (arrivalId && playing?.arrivalId !== arrivalId) remember(arrivalId, data);
        break;
      }
      case "arrival.replay.requested": {
        const arrivalId = str(data.arrivalId);
        if (arrivalId && arrivalId !== playing?.arrivalId && arrivalId !== starting?.arrivalId && !queue.includes(arrivalId)) queue.push(arrivalId);
        next();
        break;
      }
      case "arrival.replay.skipped": {
        const arrivalId = str(data.arrivalId);
        queue = queue.filter((id) => id !== arrivalId);
        if (arrivalId && (playing?.arrivalId === arrivalId || starting?.arrivalId === arrivalId)) {
          stopPlaying();
          next();
        }
        break;
      }
      case "renderer.ack": {
        // TRACE_B confirmed the start: now the walk begins.
        if (starting && str(data.eventId) === starting.eventId) {
          window.clearTimeout(ackTimer);
          const { arrivalId } = starting;
          starting = null;
          play(arrivalId);
        }
        break;
      }
      case "renderer.rejected": {
        // The start was refused (lease, state): drop that arrival and try the next.
        if (starting && str(data.eventId) === starting.eventId) {
          window.clearTimeout(ackTimer);
          known.delete(starting.arrivalId);
          starting = null;
          next();
        }
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
        setState("rejected", "版が合いません");
        break;
      }
    }
  };

  const needLogin = () => {
    waitingForLogin = true;
    setState("login");
  };

  const scheduleRetry = () => {
    if (closed) return;
    setState("connecting");
    window.clearTimeout(retry);
    retry = window.setTimeout(() => void open(), BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    attempt += 1;
  };

  /** A two-minute display credential, bought with the operator's Google ID token. */
  const credential = async (): Promise<string | null> => {
    const idToken = options.idToken();
    if (!idToken) {
      needLogin();
      return null;
    }
    let response: Response;
    try {
      response = await fetchImpl(`${api}/v1/operator/display-tokens`, { method: "POST", headers: { Authorization: `Bearer ${idToken}` } });
    } catch (error) {
      console.error("display link: the credential request did not reach TRACE_B", error);
      scheduleRetry();
      return null;
    }
    if (response.status === 401) {
      // The Google sign-in expired or is not on the operator list.
      needLogin();
      return null;
    }
    if (response.status === 403) {
      setState("rejected", "このページの URL が TRACE_B に許可されていません");
      return null;
    }
    if (!response.ok) {
      console.error(`display link: the credential request failed (${response.status})`);
      scheduleRetry();
      return null;
    }
    const body: unknown = await response.json().catch(() => null);
    const token = isRecord(body) ? str(body.displayToken) : null;
    if (!token) {
      console.error("display link: TRACE_B answered without a display credential");
      scheduleRetry();
      return null;
    }
    return token;
  };

  const open = async () => {
    if (closed || state === "rejected") return;
    waitingForLogin = false;
    setState("connecting");
    const token = await credential();
    if (!token || closed) return;
    authenticated = false;
    const ws = new Impl(wsUrl);
    socket = ws;
    ws.onopen = () => {
      // The credential goes only in this first message: never in the URL, a header or storage.
      ws.send(JSON.stringify({ schemaVersion: 1, type: "renderer.authenticate", displayToken: token, ...options.versions }));
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
    ws.onclose = (event: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      leaseId = null;
      authenticated = false;
      stopPlaying();
      window.clearInterval(heartbeat);
      window.clearInterval(reacquire);
      if (closed || state === "rejected") return;
      if (event.code === CLOSE_VERSION_MISMATCH) return setState("rejected", "版が合いません");
      if (event.code === CLOSE_TOO_BIG) return setState("rejected", "送ったメッセージが大きすぎます");
      if (event.code === CLOSE_UNAUTHENTICATED) {
        // A credential refused twice in a row: the sign-in itself needs renewing.
        unauthorizedInRow += 1;
        if (unauthorizedInRow >= 2) return needLogin();
      }
      scheduleRetry();
    };
  };

  void open();
  return {
    signedIn() {
      if (!closed && (waitingForLogin || state === "login")) {
        unauthorizedInRow = 0;
        void open();
      }
    },
    close() {
      closed = true;
      window.clearInterval(heartbeat);
      window.clearInterval(reacquire);
      window.clearTimeout(retry);
      window.clearTimeout(hold);
      stopPlaying();
      socket?.close();
      socket = null;
    },
  };
}
