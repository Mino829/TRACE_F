"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { arrivalQrUrl } from "@/lib/trace-api/arrival-code";
import type { ArrivalProof, OperatorSession } from "@/lib/display/operator-session";

const REFRESH_MS = 15_000;
const SHOW_MIN_MS = 3_000;
type LiveToken = ArrivalProof & { since: number };

/** Only an independently authorized operator can mint a real arrival QR. */
export function ArrivalQr({ session, authorized, dev }: { session: OperatorSession | null; authorized: boolean; dev: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState<number | null>(null);
  const [token, setToken] = useState<LiveToken | null>(null);
  const showing = authorized && token && now !== null && token.expiresAt - now > SHOW_MIN_MS ? token : null;
  const text = showing?.checkpointToken ?? null;
  const nextAt = showing ? Math.min(showing.expiresAt - SHOW_MIN_MS, showing.since + REFRESH_MS) : 0;
  const left = showing && now !== null ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : 0;
  const share = showing && now !== null ? Math.min(1, Math.max(0, (nextAt - now) / Math.max(1, nextAt - showing.since))) : 0;

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 250);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!session || !authorized) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const proof = await session.proof();
        if (!stopped) setToken({ ...proof, since: Date.now() });
      } catch {
        if (!stopped) setToken(null);
      }
      if (!stopped) timer = window.setTimeout(poll, REFRESH_MS);
    };
    void poll();
    return () => { stopped = true; window.clearTimeout(timer); };
  }, [session, authorized]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let stopped = false;
    if (text === null) {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    // Render off-screen first: a stale async render cannot resurrect a revoked QR.
    const scratch = document.createElement("canvas");
    const render = async () => {
      try {
        await QRCode.toCanvas(scratch, arrivalQrUrl(text, window.location.origin), { errorCorrectionLevel: "L", margin: 0, width: 360, color: { dark: "#0c0c0dff", light: "#00000000" } });
        if (stopped) return;
        canvas.width = scratch.width;
        canvas.height = scratch.height;
        canvas.getContext("2d")?.drawImage(scratch, 0, 0);
      } catch {
        if (!stopped) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
    void render();
    return () => { stopped = true; };
  }, [text]);

  return (
    <figure className="dsp-qr">
      <div className="dsp-qr__frame bracket">
        <canvas ref={canvasRef} className="dsp-qr__code" aria-label="到着の QR コード" />
        <p className="dsp-qr__sign"><span>ASYNC</span><span>TRACE</span></p>
      </div>
      <figcaption className="dsp-qr__meta">
        {/* Why there is no code yet is for the team (?dev); visitors read only that it is coming. */}
        <span>{showing ? "ARRIVAL QR" : !dev ? "ARRIVAL QR · 準備中" : session ? "ARRIVAL QR · 運営認証待ち" : "ARRIVAL QR · 未設定"}</span>
        <span>NEXT {showing ? String(left).padStart(2, "0") : "--"}s</span>
      </figcaption>
      <div className="dsp-qr__bar"><span style={{ width: `${share * 100}%` }} /></div>
    </figure>
  );
}
