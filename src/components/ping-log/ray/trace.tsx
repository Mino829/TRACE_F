"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { LogEntry } from "@/lib/ping-log/store";
import { PLACES } from "@/lib/places/places";
import type { TraceScene } from "@/lib/ray/trace-scene";

import { BlobImage } from "../blob-image";
import { clock } from "../ui";
import { Print } from "./prints";
import { NoteBar } from "./stage";

/**
 * 振り返り3D (#50), on the keepsake screen above the 作品: the way from the
 * first photo's place to ShibaLab, still, among the buildings, with each
 * photo standing at the place it was taken (lib/ray/trace-scene.ts). Below
 * it, the same places as a list, which is all there is where WebGL is not.
 * The photos are read from the phone; nothing is fetched but the code that
 * draws.
 */

type Pin = { entry: LogEntry; number: number; checkpointId: string | null };

/**
 * `photos`: those whose picture this phone keeps, oldest first. They are read
 * once: the keepsake keys this section by them, so other photos mount a new
 * one with a new canvas (a disposed scene leaves its canvas's context lost).
 */
export function TraceSection({ photos }: { photos: LogEntry[] }) {
  const headId = useId();
  const listId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pinsRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TraceScene | null>(null);
  const [state, setState] = useState<"loading" | "on" | "off">("loading");
  const [chosen, setChosen] = useState<number | null>(null);
  const [pins] = useState<Pin[]>(() =>
    photos.map((entry, index) => ({ entry, number: index + 1, checkpointId: entry.record.place?.checkpointId ?? null })),
  );

  useEffect(() => {
    let alive = true;
    // The drawing code comes with the campus graph, so it loads only now.
    import("@/lib/ray/trace-scene").then(
      ({ createTraceScene, traceWay }) => {
        const host = hostRef.current;
        const canvas = canvasRef.current;
        if (!alive || !host || !canvas) return;
        try {
          const way = traceWay(pins.map((pin) => ({ checkpointId: pin.checkpointId ?? "", graphVersion: pin.entry.record.place?.graphVersion ?? "" })));
          // Photos taken at one place stand side by side over it.
          const shared = new Map<string, number>();
          const offsets = pins.map((pin) => {
            const key = pin.checkpointId ?? "";
            const order = shared.get(key) ?? 0;
            shared.set(key, order + 1);
            return order;
          });
          const counts = pins.map((pin) => shared.get(pin.checkpointId ?? "") ?? 1);
          const scene = createTraceScene(host, canvas, PLACES, way, {
            onFrame: () => {
              const elements = pinsRef.current?.children;
              if (!elements) return;
              pins.forEach((_, index) => {
                const element = elements[index] as HTMLElement | undefined;
                const at = way.stops[index];
                const point = at ? scene.project(at) : null;
                if (!element) return;
                element.hidden = !point;
                if (point) element.style.transform = `translate3d(${(point.x + (offsets[index] - (counts[index] - 1) / 2) * 34).toFixed(1)}px,${point.y.toFixed(1)}px,0)`;
              });
            },
            onLost: () => setState("off"),
          });
          sceneRef.current = scene;
          setState("on");
        } catch {
          setState("off");
        }
      },
      () => {
        if (alive) setState("off");
      },
    );
    return () => {
      alive = false;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [pins]);

  const pick = chosen === null ? null : pins[chosen];
  const pickMeta = pick?.entry.record.photo;

  return (
    <section className="keep__trace" aria-labelledby={headId}>
      <p className="mono">Trace</p>
      <h2 className="h3" id={headId}>
        あなたの軌跡
      </h2>

      {state !== "off" && (
        <div className="trace__view">
          <div ref={hostRef} className="trace__host" aria-hidden="true">
            <canvas ref={canvasRef} className="trace__canvas" />
            <div ref={pinsRef} className="trace__pins">
              {pins.map((pin, index) => (
                <button
                  key={pin.entry.id}
                  type="button"
                  className={`trace__pin${chosen === index ? " is-on" : ""}`}
                  tabIndex={-1}
                  hidden
                  onClick={() => setChosen(chosen === index ? null : index)}
                >
                  <BlobImage blob={pin.entry.photo as Blob} alt="" />
                </button>
              ))}
            </div>
            {state === "loading" && <p className="trace__wait mono mono--dim">Loading</p>}
          </div>
          <div className="trace__tools">
            <span className="mono mono--dim">ドラッグで回転・ピンチで拡大</span>
            <button type="button" className="link" disabled={state !== "on"} onClick={() => sceneRef.current?.reset()}>
              元の向きにもどす
            </button>
          </div>
        </div>
      )}
      {state === "off" && <NoteBar text={"この端末では 3D で表示できないので、撮った場所を順に並べています。"} />}

      {pick && (
        <div className="trace__pick" aria-live="polite">
          <Print
            source={{ blob: pick.entry.photo as Blob }}
            number={pick.number}
            time={clock(pick.entry.record.takenAt)}
            ratio={pickMeta && pickMeta.width > 0 && pickMeta.height > 0 ? pickMeta.width / pickMeta.height : 3 / 4}
            small
          />
          <p className="h3">{pick.entry.record.place?.name ?? "場所の記録なし"}</p>
        </div>
      )}

      <div className="trace__list">
        <h3 className="h3" id={listId}>
          撮った場所
        </h3>
        <ol aria-labelledby={listId}>
          {pins.map((pin, index) => (
            <li key={pin.entry.id}>
              <button type="button" className={`trace__row${chosen === index ? " is-on" : ""}`} aria-pressed={chosen === index} onClick={() => setChosen(chosen === index ? null : index)}>
                <BlobImage blob={pin.entry.photo as Blob} alt="" className="trace__thumb" />
                <span className="trace__when mono">
                  {pin.number}枚目 <span className="latin">{clock(pin.entry.record.takenAt)}</span>
                </span>
                <span className="trace__where">{pin.entry.record.place?.name ?? "場所の記録なし"}</span>
              </button>
            </li>
          ))}
          <li>
            <div className="trace__row trace__row--end">
              <span className="trace__ring" aria-hidden="true" />
              <span className="trace__when mono">Arrived</span>
              <span className="trace__where">ShibaLab（教室棟301）</span>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
