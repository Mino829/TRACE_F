"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The exhibit screen (issue #24). Prototype: replays a sample walk on a loop.
 * Later the arrival QR flow will hand over a visitor's node list instead.
 *
 * Query: ?duration=20 (seconds per walk), ?stops=big-tree,koryu-plaza,shibalab
 * (checkpoint ids; the walk between them is the shortest one on the network).
 */
export function DisplayClient() {
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const walkRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<{ stop: string; progress: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      // three.js loads only on this route.
      const [{ createPlayer }, graph, { buildRoutePath }] = await Promise.all([
        import("@/lib/display/player"),
        import("@/lib/display/campus-graph"),
        import("@/lib/display/route-path"),
      ]);
      const params = new URLSearchParams(window.location.search);
      const duration = Number(params.get("duration")) || 20;
      const stops = params.get("stops")?.split(",").filter(Boolean) ?? [...graph.SAMPLE_STOPS];
      const path = buildRoutePath(graph.routeThrough(stops));
      let restart: number | undefined;
      const player = await createPlayer({
        overview: overviewRef.current!,
        firstPerson: walkRef.current!,
        duration,
        onProgress: ({ s, length, stop, done }) => {
          setStatus({ stop, progress: s / length });
          if (done && restart === undefined) {
            restart = window.setTimeout(() => {
              restart = undefined;
              player.play(path);
            }, 3000);
          }
        },
      });
      if (disposed) {
        player.dispose();
        return;
      }
      player.play(path);
      cleanup = () => {
        window.clearTimeout(restart);
        player.dispose();
      };
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  return (
    <div className="display-root">
      <canvas ref={overviewRef} className="display-view" aria-label="キャンパス全体と軌跡" />
      <canvas ref={walkRef} className="display-view" aria-label="一人称の視点" />
      <div className="display-caption">
        {error ? (
          <p className="display-error">読み込めませんでした：{error}</p>
        ) : status ? (
          <>
            <p className="display-stop">{status.stop}</p>
            <div className="display-bar"><span style={{ width: `${status.progress * 100}%` }} /></div>
          </>
        ) : (
          <p className="display-stop">読み込み中…</p>
        )}
      </div>
    </div>
  );
}
