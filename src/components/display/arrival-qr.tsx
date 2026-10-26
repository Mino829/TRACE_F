"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import { arrivalQrText } from "@/lib/trace-api/arrival-code";

/** How long one demo code stays on screen (#10: shown on the projector, refreshed on a timer). */
const PERIOD_SECONDS = 30;
/** The arrival issuer on the display PC (arrival-issuer/README.md). Unset, the frame shows the demo code. */
const ISSUER_URL = (process.env.NEXT_PUBLIC_ARRIVAL_ISSUER_URL ?? "").replace(/\/$/, "");
/** How often the screen asks the issuer for the current token. */
const POLL_MS = 2_000;
/** A token with less left than this comes off the screen; a phone could not send it in time. */
const SHOW_MIN_MS = 3_000;

/** The issuer's current token, and when it first came on screen (for the bar). */
type LiveToken = { checkpointToken: string; expiresAt: number; nextAt: number; since: number };

/**
 * The arrival QR for the booth screen. Only someone standing in front of the
 * projector can read the current code.
 *
 * With NEXT_PUBLIC_ARRIVAL_ISSUER_URL set, the code is TRACE_B's signed arrival
 * token, which the display PC's issuer renews every 15 s, packed to 33×33
 * modules (lib/trace-api/arrival-code.ts) or, when it cannot be, as it is; the
 * phone reads it with the camera inside /log. If the issuer has none, the
 * frame stays empty and says OFFLINE. Unset, the code is a placeholder URL
 * that changes every PERIOD_SECONDS, and the frame is marked DEMO.
 */
export function ArrivalQr() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Counted in the browser only, so the server render and the first client render agree.
  const [now, setNow] = useState<number | null>(null);
  const [token, setToken] = useState<LiveToken | null>(null);
  const slot = now === null ? null : Math.floor(now / 1000 / PERIOD_SECONDS);
  const showing = ISSUER_URL && token && now !== null && token.expiresAt - now > SHOW_MIN_MS ? token : null;
  const text = ISSUER_URL ? (showing?.checkpointToken ?? null) : slot === null ? null : `demo-${slot.toString(36)}`;
  const left = ISSUER_URL
    ? showing && now !== null ? Math.max(0, Math.ceil((showing.nextAt - now) / 1000)) : 0
    : now === null ? PERIOD_SECONDS : PERIOD_SECONDS - (Math.floor(now / 1000) % PERIOD_SECONDS);
  const share = ISSUER_URL
    ? showing && now !== null ? Math.min(1, Math.max(0, (showing.nextAt - now) / Math.max(1, showing.nextAt - showing.since))) : 0
    : left / PERIOD_SECONDS;

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!ISSUER_URL) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const response = await fetch(`${ISSUER_URL}/arrival-token`, { cache: "no-store" });
        if (response.status === 503) {
          if (!stopped) setToken(null);
        } else if (response.ok) {
          const body = await response.json();
          const expiresAt = Date.parse(body?.expiresAt);
          const nextAt = Date.parse(body?.nextAt);
          if (!stopped && typeof body?.checkpointToken === "string" && Number.isFinite(expiresAt)) {
            const receivedAt = Date.now();
            setToken((previous) => ({
              checkpointToken: body.checkpointToken,
              expiresAt,
              nextAt: Number.isFinite(nextAt) ? nextAt : expiresAt,
              since: previous && previous.checkpointToken === body.checkpointToken ? previous.since : receivedAt,
            }));
          }
        }
      } catch {
        // The issuer is unreachable for a moment: the last token stays until it runs out.
      }
      if (!stopped) timer = window.setTimeout(poll, POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    if (text === null) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const content = ISSUER_URL ? arrivalQrText(text) : `${window.location.origin}/log?arrival=${text}`;
    // L: the code is lit on a screen, not printed and scuffed, so bigger modules matter more than recovery.
    QRCode.toCanvas(canvas, content, {
      errorCorrectionLevel: "L",
      margin: 0,
      width: 360,
      color: { dark: "#0c0c0dff", light: "#00000000" },
    }).catch(() => {});
  }, [text]);

  return (
    <figure className="dsp-qr">
      <div className="dsp-qr__frame bracket">
        <canvas ref={canvasRef} className="dsp-qr__code" aria-label="到着の QR コード" />
        <p className="dsp-qr__sign">
          <span>ASYNC</span>
          <span>TRACE</span>
        </p>
      </div>
      <figcaption className="dsp-qr__meta">
        <span>{ISSUER_URL ? (showing ? "ARRIVAL QR" : "ARRIVAL QR · OFFLINE") : "ARRIVAL QR · DEMO"}</span>
        <span>NEXT {ISSUER_URL && !showing ? "--" : String(left).padStart(2, "0")}s</span>
      </figcaption>
      <div className="dsp-qr__bar">
        <span style={{ width: `${share * 100}%` }} />
      </div>
    </figure>
  );
}
