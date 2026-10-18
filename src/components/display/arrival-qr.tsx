"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

/** How long one arrival code stays on screen (#10: shown on the projector, refreshed on a timer). */
const PERIOD_SECONDS = 30;

/**
 * The arrival QR for the booth screen. Only someone standing in front of the
 * projector can read the current code, and it changes every PERIOD_SECONDS.
 *
 * Prototype: the code is a placeholder URL. The real one will carry a signed,
 * short-lived arrival token from TRACE_B (#10, TRACE_B #8); until then the
 * frame is marked DEMO.
 */
export function ArrivalQr() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const slot = Math.floor(now / 1000 / PERIOD_SECONDS);
  const left = PERIOD_SECONDS - (Math.floor(now / 1000) % PERIOD_SECONDS);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const url = `${window.location.origin}/log?arrival=demo-${slot.toString(36)}`;
    QRCode.toCanvas(canvasRef.current!, url, {
      errorCorrectionLevel: "M",
      margin: 0,
      width: 360,
      color: { dark: "#0c0c0dff", light: "#00000000" },
    }).catch(() => {});
  }, [slot]);

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
        <span>ARRIVAL QR · DEMO</span>
        <span>NEXT {String(left).padStart(2, "0")}s</span>
      </figcaption>
      <div className="dsp-qr__bar">
        <span style={{ width: `${(left / PERIOD_SECONDS) * 100}%` }} />
      </div>
    </figure>
  );
}
