"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The campus as wire only, turning in the room the title leaves between the
 * steps and the button (lib/ray/campus-wire.ts). It is only a picture: where
 * WebGL is not, the room stays dark.
 */
export function CampusWire() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [off, setOff] = useState(false);

  useEffect(() => {
    let alive = true;
    let wire: { dispose: () => void } | null = null;
    // Loaded after the title is up, so the first screen does not wait for the campus.
    import("@/lib/ray/campus-wire").then(
      ({ createCampusWire }) => {
        const host = hostRef.current;
        const canvas = canvasRef.current;
        if (!alive || !host || !canvas) return;
        try {
          wire = createCampusWire(host, canvas, { onLost: () => setOff(true) });
        } catch {
          setOff(true);
        }
      },
      () => undefined,
    );
    return () => {
      alive = false;
      wire?.dispose();
    };
  }, []);

  return (
    <div ref={hostRef} className="wire" aria-hidden="true">
      {!off && <canvas ref={canvasRef} />}
    </div>
  );
}
