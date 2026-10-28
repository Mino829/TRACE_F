"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { isArrivalCode, qrReader, type CodeReader, type DetectedCode } from "@/lib/ping-log/qr-reader";
import { arrivalTokenFor } from "@/lib/trace-api/arrival-code";
import {
  TraceApiError,
  arrivalAttempt,
  getExperience,
  sendArrival,
  skipArrival,
  type ArrivalAttempt,
  type MemoryCredential,
  type ReplayStatus,
} from "@/lib/trace-api/client";
import type { LogEntry } from "@/lib/ping-log/store";
import { sendOnce } from "@/lib/trace-api/session";

import { useLayer } from "../layer";
import { clock } from "../ui";
import { ScanWindow, placeTrackers, useBeam } from "./demo";
import { KeepsakeScreen } from "./keepsake";
import { TraceScreen } from "./trace";
import { HomeMark, Icon, Phrases, Screen, Sentences, SWAP, useField, useRay } from "./stage";

/**
 * Arriving at ShibaLab for real, while /log works with TRACE_B: the phone's
 * rear camera reads the QR code in the booth's projected picture, the arrival
 * goes to TRACE_B, and the phone follows the replay on the room's screen
 * until it has played or been skipped. Then the photos taken before arriving
 * become the keepsake (keepsake.tsx), and the way between their places
 * 振り返り3D (trace.tsx). Without the backend, the home's button
 * opens the demo (demo.tsx) instead.
 *
 * As in the demo, the phone shows no queue, no wait and no symbol. The camera
 * picture never leaves the phone: only the code read from it is sent.
 */

export type ArrivalTarget = { experienceId: string; memory: MemoryCredential };

/** 15 a minute: half of TRACE_B's 30 per participant, which the arrival and the skip share. */
const POLL_MS = 4000;
const READ_EVERY_MS = 150;
/** After a failed try, the same code in view is not sent again before this. */
const RETRY_AFTER_MS = 2000;
/** The trackers leave a code that has not been seen for this long. */
const LOST_AFTER_MS = 600;

const STATUSES: readonly string[] = ["queued", "playing", "completed", "skipped"];

function replayStatus(value: unknown): ReplayStatus | null {
  return typeof value === "string" && STATUSES.includes(value) ? (value as ReplayStatus) : null;
}

function isFinal(status: ReplayStatus | null): boolean {
  return status === "completed" || status === "skipped";
}

type ReadAnswer = { ok: true } | { ok: false; code: string; message: string; retryAfter: number | null };

/**
 * onArrived: TRACE_B has the arrival, now or from before; it ends the photo reminder then.
 * toKeepsake: opened from home after arriving, so a replay that is over leads straight to the keepsake.
 */
export function ArrivalFlow({
  target,
  photos,
  contact,
  toKeepsake,
  inert,
  onClose,
  onArrived,
  onDelete,
}: {
  target: ArrivalTarget;
  /** This participation's photos, oldest first. */
  photos: LogEntry[];
  /** Where to ask about the data, shown with the keepsake. */
  contact: string;
  toKeepsake: boolean;
  inert: boolean;
  onClose: () => void;
  onArrived: (memorySessionId: string) => void;
  /** Asks before deleting a photo (#51). */
  onDelete: (entry: LogEntry, number: number) => void;
}) {
  const { go } = useRay();
  const [step, setStep] = useState<"scan" | "replay" | "keepsake" | "trace">("scan");
  const [status, setStatus] = useState<ReplayStatus | null>(null);
  // Unknown when the arrival was earlier than this screen.
  const [arrivedAt, setArrivedAt] = useState<string | null>(null);
  const close = useLayer("#arrival", onClose);
  const leave = useCallback(() => void go(close), [go, close]);
  const attempt = useRef<ArrivalAttempt | null>(null);
  // A code is on its way, or has arrived: the check below no longer moves the screen.
  const reading = useRef(false);
  const arrived = useRef(false);
  const { experienceId, memory } = target;
  const onArrivedRef = useRef(onArrived);
  useEffect(() => {
    onArrivedRef.current = onArrived;
  }, [onArrived]);

  // Arrived already (a reload, or the button pressed again): straight to where the replay stands.
  useEffect(() => {
    let alive = true;
    getExperience(experienceId, memory)
      .then((state) => {
        const known = replayStatus(state.replayStatus);
        if (!alive || !known || reading.current || arrived.current) return;
        onArrivedRef.current(memory.memorySessionId);
        void go(() => {
          setStatus(known);
          setStep(toKeepsake && isFinal(known) ? "keepsake" : "replay");
        });
      })
      // The camera is starting anyway; sending the code will tell.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [go, experienceId, memory, toKeepsake]);

  const read = useCallback(
    async (code: string): Promise<ReadAnswer> => {
      reading.current = true;
      // The same code read again resends the same try with the same key, so an answer lost on the way
      // still counts once; one tab sends at a time, and after an answer every tab gets that answer.
      if (attempt.current?.checkpointToken !== code) attempt.current = arrivalAttempt(code);
      const current = attempt.current;
      try {
        const result = await sendOnce(memory.memorySessionId, "arrival", current, (key) => sendArrival(memory, current, key));
        arrived.current = true;
        onArrivedRef.current(memory.memorySessionId);
        setStatus(replayStatus(result.status) ?? "queued");
        setArrivedAt(clock(Date.now()));
        return { ok: true };
      } catch (error) {
        const failure = error instanceof TraceApiError ? error : new TraceApiError(0, "UNKNOWN", null);
        return { ok: false, code: failure.code, message: failure.message, retryAfter: failure.retryAfter };
      } finally {
        reading.current = false;
      }
    },
    [memory],
  );

  if (step === "scan") return <CameraScan inert={inert} onCancel={leave} onRead={read} onArrived={() => setStep("replay")} />;
  if (step === "keepsake") {
    return (
      <KeepsakeScreen
        photos={photos}
        deleteAfter={memory.deleteAfter}
        contact={contact}
        inert={inert}
        onDelete={onDelete}
        onTrace={() => void go(() => setStep("trace"))}
        onLeave={leave}
      />
    );
  }
  if (step === "trace") return <TraceScreen photos={photos} inert={inert} onBack={() => void go(() => setStep("keepsake"))} />;
  return (
    <Replay
      target={target}
      status={status}
      arrivedAt={arrivedAt}
      photos={photos.length}
      inert={inert}
      onStatus={setStatus}
      onKeepsake={() => void go(() => setStep("keepsake"))}
      onLeave={leave}
    />
  );
}

/* ------------------------------------------------------------------- scan */

/** Errors that reading again cannot mend: the participation is over, or the booth is not taking arrivals. */
const FINAL_ERRORS = new Set(["UNAUTHORIZED", "NOT_FOUND", "STATE_CONFLICT", "NOT_AVAILABLE"]);

type Camera = "starting" | "on" | "denied" | "missing" | "busy" | "failed" | "unsupported";

const CAMERA_TROUBLE: Record<Exclude<Camera, "starting" | "on">, string> = {
  denied: "カメラの使用が許可されていません。設定で、このサイトに\nカメラの使用を許可してから\n「もう一度試す」を押してください。",
  missing: "カメラが見つかりませんでした。",
  busy: "カメラを起動できませんでした。ほかのアプリがカメラを使っていれば、\n閉じてから「もう一度試す」を\n押してください。",
  failed: "カメラを起動できませんでした。「もう一度試す」を押してください。",
  unsupported: "このブラウザではカメラを使えません。Safari か Chrome で開いてください。",
};

/** Without a secure page (https) or camera support, there is no getUserMedia at all. */
function hasCamera(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

function cameraTrouble(error: unknown): Camera {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "failed";
}

/**
 * The rear camera, read a few times a second. Its picture goes through the
 * field as the demo's drawing does; without WebGL, the video itself shows, in
 * grey. Only one code is sent at a time, a refused code is not sent again, and
 * the camera stops whenever the page is hidden and starts again when it is back.
 */
function CameraScan({
  inert,
  onCancel,
  onRead,
  onArrived,
}: {
  inert: boolean;
  onCancel: () => void;
  onRead: (code: string) => Promise<ReadAnswer>;
  onArrived: () => void;
}) {
  const { field, fx } = useRay();
  const windowRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackers = useRef<(HTMLDivElement | null)[]>([]);
  const [camera, setCamera] = useState<Camera>(() => (hasCamera() ? "starting" : "unsupported"));
  // Bumped by "もう一度試す" to ask for the camera again.
  const [tries, setTries] = useState(0);
  const [found, setFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  // A final error: nothing more to read.
  const [ended, setEnded] = useState(false);
  useField("day", { scene: 2, splitOn: 0, invert: 0, imgBg: 1, gain: 1.15, bias: -0.04 }, "scan");

  const onReadRef = useRef(onRead);
  const onArrivedRef = useRef(onArrived);
  useEffect(() => {
    onReadRef.current = onRead;
    onArrivedRef.current = onArrived;
  }, [onRead, onArrived]);

  useEffect(() => {
    const video = videoRef.current;
    const box = windowRef.current;
    if (!field || !video || !box || ended || !hasCamera()) return;
    let alive = true;
    let stream: MediaStream | null = null;
    let starting = false;
    let timer: number | undefined;
    // A code is on its way, or the screen is leaving: nothing else is sent.
    let busy = false;
    let resumeAt = 0;
    let seenAt = 0;
    let reader: CodeReader | null = null;
    const refused = new Set<string>();
    let noted = "";

    // The camera's picture for the field: dark until the camera is on, then the video at a small size.
    const picture = document.createElement("canvas");
    picture.width = 300;
    picture.height = 400;
    const context = picture.getContext("2d");
    if (!context) return;
    context.fillStyle = "#1d1e20";
    context.fillRect(0, 0, picture.width, picture.height);
    const uv = (): [number, number, number, number] => {
      const rect = box.getBoundingClientRect();
      const canvas = field.canvas.getBoundingClientRect();
      return [(rect.left - canvas.left) / canvas.width, 1 - (rect.bottom - canvas.top) / canvas.height, (rect.right - canvas.left) / canvas.width, 1 - (rect.top - canvas.top) / canvas.height];
    };
    field.image(picture, uv(), true);
    const onResize = () => field.image(picture, uv(), true);
    window.addEventListener("resize", onResize);

    const draw = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      const height = Math.round((360 * video.videoHeight) / video.videoWidth);
      if (picture.width !== 360 || picture.height !== height) {
        picture.width = 360;
        picture.height = height;
        context.drawImage(video, 0, 0, picture.width, picture.height);
        field.image(picture, uv(), true);
        return;
      }
      context.drawImage(video, 0, 0, picture.width, picture.height);
      field.image(picture, null, true);
    };

    const stop = () => {
      window.clearTimeout(timer);
      field.follow(null);
      field.stopImage();
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    };

    // The four corners onto the window, which shows the video as cover crops it.
    const showCorners = (code: DetectedCode) => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (code.cornerPoints.length !== 4 || !width || !height) return;
      const rect = box.getBoundingClientRect();
      const boxAspect = rect.width / rect.height;
      const aspect = width / height;
      const cover: [number, number] = aspect > boxAspect ? [boxAspect / aspect, 1] : [1, aspect / boxAspect];
      // The detector goes round from the top left; the trackers go row by row.
      const [topLeft, topRight, bottomRight, bottomLeft] = code.cornerPoints;
      const corners = [topLeft, topRight, bottomLeft, bottomRight].map((point): [number, number] => [point.x / width, point.y / height]);
      placeTrackers(trackers.current, rect, corners, cover);
      setFound(true);
    };

    // The room takes over: the camera tears, stops, and the screen splits to negative.
    const enter = async () => {
      field.burst(1);
      await fx?.tear(420, 1);
      stop();
      await fx?.split(SWAP, 1250);
      flushSync(() => onArrivedRef.current());
      fx?.clear();
    };

    const send = async (code: string) => {
      busy = true;
      setSending(true);
      setNotice("");
      const answer = await onReadRef.current(code);
      if (!alive) return;
      if (answer.ok) {
        await enter();
        return;
      }
      setSending(false);
      setFound(false);
      setNotice(answer.message);
      if (FINAL_ERRORS.has(answer.code)) {
        stop();
        setEnded(true);
        return;
      }
      if (answer.code === "INVALID_CHECKPOINT") refused.add(code);
      resumeAt = Date.now() + Math.max(RETRY_AFTER_MS, (answer.retryAfter ?? 0) * 1000);
      busy = false;
      // The page was hidden while the code was on its way.
      if (!stream && !document.hidden) void start();
    };

    const look = (codes: DetectedCode[]) => {
      const code = codes.find((item) => item.rawValue);
      if (!code) {
        if (seenAt && Date.now() - seenAt > LOST_AFTER_MS) setFound(false);
        return;
      }
      seenAt = Date.now();
      showCorners(code);
      const text = code.rawValue.trim();
      if (!isArrivalCode(text)) {
        if (text !== noted) setNotice("これは到着用の QR コードではありません。ASYNC のブースに映っている\nQR コードを読み取ってください。");
        noted = text;
        return;
      }
      // The booth packs TRACE_B's token; what goes out is the token itself.
      const token = arrivalTokenFor(text);
      if (!refused.has(token)) void send(token);
    };

    const scan = async () => {
      if (!alive || !stream) return;
      if (!busy && Date.now() >= resumeAt && video.readyState >= 2) {
        try {
          reader ??= await qrReader();
          const codes = await reader.detect(video);
          if (alive && !busy) look(codes);
        } catch {
          // The reader could not load (on an iPhone it is fetched on first use), or a frame could not be read.
          if (!reader) {
            setNotice("QR コードを読み取る\n準備ができませんでした。電波の良い場所で、少し待ってください。");
            resumeAt = Date.now() + 3000;
          }
        }
      }
      if (alive && stream) timer = window.setTimeout(() => void scan(), READ_EVERY_MS);
    };

    const start = async () => {
      if (starting || stream) return;
      starting = true;
      setCamera("starting");
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!alive || document.hidden) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        // iPhone Safari plays a muted, inline video without a tap; React does not set the muted attribute itself.
        video.muted = true;
        video.srcObject = next;
        await video.play().catch(() => undefined);
        setCamera("on");
        if (field.ok) field.follow(draw);
        void scan();
      } catch (error) {
        if (alive) setCamera(cameraTrouble(error));
      } finally {
        starting = false;
      }
    };

    // A hidden page lets go of the camera, and takes it again when it is back.
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!busy) void start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    void start();

    return () => {
      alive = false;
      stop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [field, fx, tries, ended]);

  const trouble = camera === "starting" || camera === "on" ? null : CAMERA_TROUBLE[camera];
  const retry = trouble !== null && camera !== "missing" && camera !== "unsupported" && !ended;

  return (
    <Screen className="scan" inert={inert}>
      <div className="topbar">
        <span>
          <button type="button" className="link" onClick={onCancel}>
            <Icon name="close" />
            やめる
          </button>
        </span>
        <span className="mono">Scan</span>
        <span className="mono mono--dim">Live</span>
      </div>
      <h1 className="h2 scan__head">
        <Phrases text={"ASYNC のブースの QR コードを、\n枠に入れてください"} />
      </h1>
      <ScanWindow windowRef={windowRef} trackers={trackers} locked={found || sending}>
        <video ref={videoRef} className={`scan__video${field && !field.ok ? " is-shown" : ""}`} muted playsInline autoPlay aria-hidden="true" />
      </ScanWindow>
      <div className="scan__status">
        <p className="h3" role="status">
          {sending ? "読み取りました" : ended || trouble ? "読み取りを止めています" : camera === "on" ? "読み取っています…" : "カメラを起動しています…"}
        </p>
        <span className="mono">{sending ? "Lock" : ended || trouble ? "Stop" : camera === "on" ? "Searching" : "Camera"}</span>
      </div>
      {(trouble || notice) && (
        <p className="note-bar" role="alert" style={{ marginTop: 12 }}>
          <Sentences text={trouble ?? notice} />
        </p>
      )}
      {retry && (
        <button type="button" className="btn btn--line" onClick={() => setTries((count) => count + 1)}>
          もう一度試す
        </button>
      )}
      {ended && (
        <button type="button" className="btn" onClick={onCancel}>
          ホームへもどる
        </button>
      )}
      <p className="small">
        <Sentences text={"カメラの映像は、\nQR コードを読み取るためだけに使います。映像は保存も送信もしません。"} />
      </p>
    </Screen>
  );
}

/* ----------------------------------------------------------------- replay */

function replayText(status: ReplayStatus | null, skippedHere: boolean): { label: string; title: string; body: string } {
  if (status === "playing") return { label: "Playback", title: "スクリーンを見てください", body: "あなたの軌跡を、\nスクリーンで再生しています。" };
  if (status === "completed") return { label: "Played", title: "再生が終わりました", body: "あなたの軌跡を、\nスクリーンで再生しました。" };
  if (status === "skipped" && skippedHere) {
    return { label: "Skipped", title: "再生をやめました", body: "あなたの軌跡は、スクリーンには映りません。" };
  }
  if (status === "skipped") {
    return {
      label: "Skipped",
      title: "スクリーンでは\n再生できませんでした",
      body: "展示の都合で、\n今回はスクリーンで再生できませんでした。",
    };
  }
  return { label: "Standby", title: "スクリーンの前でお待ちください", body: "あなたの軌跡を、\nこのあとスクリーンで再生します。" };
}

/** Network failures in a row before the screen says it cannot tell how the replay stands. */
const QUIET_FAILURES = 3;

/**
 * Where the replay stands, asked of TRACE_B every few seconds while it is
 * queued or playing and the page is visible. While it is queued the
 * participant may give it up. Once it is over, played or not, the photos
 * lead on to the keepsake.
 */
function Replay({
  target,
  status,
  arrivedAt,
  photos,
  inert,
  onStatus,
  onKeepsake,
  onLeave,
}: {
  target: ArrivalTarget;
  status: ReplayStatus | null;
  arrivedAt: string | null;
  /** How many photos this phone keeps for the participation. */
  photos: number;
  inert: boolean;
  onStatus: (status: ReplayStatus) => void;
  onKeepsake: () => void;
  onLeave: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const final = isFinal(status);
  useBeam(stageRef, final);
  const [notice, setNotice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [skippedHere, setSkippedHere] = useState(false);
  const { experienceId, memory } = target;

  const ask = useCallback(async () => {
    const state = await getExperience(experienceId, memory);
    const next = replayStatus(state.replayStatus);
    if (next) onStatus(next);
  }, [experienceId, memory, onStatus]);

  useEffect(() => {
    if (final) return;
    let alive = true;
    let timer: number | undefined;
    let asking = false;
    let failures = 0;
    const poll = async () => {
      window.clearTimeout(timer);
      // A hidden page asks nothing; it asks again as soon as it is back.
      if (!alive || asking || document.hidden) return;
      asking = true;
      let wait = POLL_MS;
      try {
        await ask();
        failures = 0;
        if (alive) setNotice("");
      } catch (error) {
        const failure = error instanceof TraceApiError ? error : null;
        if (failure && (failure.code === "UNAUTHORIZED" || failure.code === "NOT_FOUND")) {
          if (alive) setNotice(failure.message);
          return;
        }
        failures += 1;
        if (alive && failures >= QUIET_FAILURES) setNotice("再生の状態を確かめられません。電波の良い場所で、そのままお待ちください。");
        wait = failure?.retryAfter ? Math.max(POLL_MS, failure.retryAfter * 1000) : POLL_MS * 2;
      } finally {
        asking = false;
      }
      if (alive) timer = window.setTimeout(() => void poll(), wait);
    };
    timer = window.setTimeout(() => void poll(), POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [final, ask]);

  const skip = async () => {
    setSkipping(true);
    try {
      await skipArrival(memory);
      setSkippedHere(true);
      onStatus("skipped");
    } catch (error) {
      // Already playing, or over: show where it stands instead.
      if (error instanceof TraceApiError && error.code === "STATE_CONFLICT") await ask().catch(() => undefined);
      else setNotice(error instanceof Error ? error.message : "");
    } finally {
      setSkipping(false);
      setConfirming(false);
    }
  };

  const text = replayText(status, skippedHere);

  return (
    <Screen inert={inert}>
      <header className="mast">
        <div className="mast__mark">
          <HomeMark onHome={onLeave} />
          <span className="mono">ShibaLab 301</span>
        </div>
        <button type="button" className="icon-btn" aria-label="ホームへもどる" onClick={onLeave}>
          <Icon name="close" />
        </button>
      </header>
      <div ref={stageRef} className="arrived__stage" aria-hidden="true" />
      <p className="mono">Arrived {arrivedAt && <span className="latin">{arrivedAt}</span>}</p>
      <section className="play" aria-labelledby="ray-play" aria-live="polite">
        <p className="mono">
          {status === "playing" ? <><span className="blink">▶</span> </> : final ? "■ " : ""}
          {text.label}
        </p>
        <h2 className="h2" id="ray-play">
          <Phrases text={text.title} />
        </h2>
        <p className="body">
          <Sentences text={text.body} />
        </p>
      </section>
      {notice && (
        <p className="note-bar" role="alert" style={{ marginTop: 18 }}>
          <Sentences text={notice} />
        </p>
      )}
      {status === "queued" && !confirming && (
        <button type="button" className="btn btn--line" style={{ marginTop: 18 }} onClick={() => setConfirming(true)}>
          再生をやめる
        </button>
      )}
      {status === "queued" && confirming && (
        <section className="bracket" style={{ marginTop: 18 }}>
          <p className="body">
            <Sentences text={"再生をやめると、\nあなたの軌跡はスクリーンに映りません。あとから再生しなおすことはできません。"} />
          </p>
          <div className="btns btns--2" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn--line" onClick={() => setConfirming(false)}>
              待つ
            </button>
            <button type="button" className="btn btn--danger" disabled={skipping} onClick={() => void skip()}>
              再生をやめる
            </button>
          </div>
        </section>
      )}
      {final && photos > 0 && (
        <section className="play__next" aria-labelledby="ray-keep">
          <p className="mono">Keepsake</p>
          <h2 className="h3" id="ray-keep">
            作品を保存できます
          </h2>
          <p className="body">
            <Sentences text={"撮った写真を、\n一枚の作品にまとめました。持ち帰れるのは、\nこの作品と写真です。"} />
          </p>
          <button type="button" className="btn" onClick={onKeepsake}>
            <Icon name="arrow" />
            作品を見る
          </button>
        </section>
      )}
      {final && photos === 0 && (
        <p className="body" style={{ marginTop: 18 }}>
          <Sentences text={"この端末には写真が残っていないので、\n作品を作れません。写真を撮ったブラウザで開くと、\n作品を保存できます。"} />
        </p>
      )}
      {final && (
        <button type="button" className={`btn${photos > 0 ? " btn--line" : ""}`} style={{ marginTop: photos > 0 ? 10 : 18 }} onClick={onLeave}>
          ホームへもどる
        </button>
      )}
    </Screen>
  );
}
