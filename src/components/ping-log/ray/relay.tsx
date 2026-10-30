"use client";

import { useEffect, useRef, useState } from "react";

import { reducedMotion } from "@/lib/ray/fx";

import { useField, useRay } from "./stage";

/**
 * The light between the phone and the room's screen, on the screen that waits
 * for the replay (arrival.tsx, and its stand-in in the demo).
 *
 * A large ring turns in the middle of the phone while the replay is ahead or
 * playing, and the beam runs from its middle up past the top edge: toward the
 * room's screen, which the visitor faces. As this screen comes up, a head of
 * light runs up the beam and out of the top edge; the room's screen brings its
 * own light in from its foot just after (RELAY_ENTERS_MS in
 * src/lib/display/relay.ts is timed to this). When the replay is over, the
 * room's screen pours the light out of its foot, and here it falls in from the
 * top edge, gathers in the ring, and the ring closes.
 *
 * - send: the light leaves as the screen comes up, then flows up the beam.
 * - gather: the light comes back; onSettled once it has gathered.
 * - done: the replay was over before this screen came up: a closed ring, no beam.
 * - off: the screen did not play it (given up): the beam goes out, the ring stops empty.
 */
export type RelayState = "send" | "gather" | "done" | "off";

/** The light flows up the beam toward the room's screen while waiting, and down it as it comes back. */
const FLOW = 16;

export function Relay({ state, onSettled }: { state: RelayState; onSettled?: () => void }) {
  const { field } = useRay();
  const ringRef = useRef<HTMLDivElement>(null);
  // The state the screen came up in sets the field once; later states move it from there.
  const [first] = useState(state);
  const [closed, setClosed] = useState(state === "done");
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useField(
    "room",
    first === "send" || first === "gather"
      ? { scene: 1, splitOn: 0, invert: 0, beam: 1, grow: 1, flow: FLOW, pool: 1, poolAt: 0, poolR: [0.06, 0.06], tip: 0, wave: 0, gather: 0 }
      : { scene: 1, splitOn: 0, invert: 0, beam: 0, flow: 0, pool: first === "done" ? 0.55 : 0.2, poolAt: 0, poolR: [0.06, 0.06], tip: 0, wave: 0, gather: 0 },
  );

  // The beam stands on the middle of the ring wherever the ring is: as the page scrolls, and as the ring settles smaller.
  useEffect(() => {
    const ring = ringRef.current;
    if (!field || !ring) return;
    let raf = 0;
    let last = "";
    const update = () => {
      raf = requestAnimationFrame(update);
      const rect = ring.getBoundingClientRect();
      const canvas = field.canvas.getBoundingClientRect();
      if (!canvas.width || !canvas.height) return;
      const x = (rect.left + rect.width / 2 - canvas.left) / canvas.width;
      const y = 1 - (rect.top + rect.height / 2 - canvas.top) / canvas.height;
      const at = `${x.toFixed(4)} ${y.toFixed(4)}`;
      if (at === last) return;
      last = at;
      field.set({ beamA: [x, y], beamB: [x, 1.3] });
    };
    update();
    return () => cancelAnimationFrame(raf);
  }, [field]);

  // The light leaves: the middle of the ring lights up, then a head of light shoots up the beam and out of the top edge.
  useEffect(() => {
    if (!field || first !== "send" || reducedMotion()) return;
    let alive = true;
    field.set({ grow: 0, pool: 0, tip: 0, wave: 0 });
    void field.to({ pool: 1 }, 420, "out").then(async () => {
      if (!alive) return;
      field.burst(0.5);
      field.set({ tip: 1, wave: 0.001 });
      void field.to({ wave: 1 }, 1100, "out").then(() => {
        if (alive) field.set({ wave: 0 });
      });
      await field.to({ grow: 1 }, 1600, "in");
      if (alive) void field.to({ tip: 0 }, 240, "out");
    });
    return () => {
      alive = false;
    };
  }, [field, first]);

  // The light comes back: it falls in from the top edge along the beam, which now flows down, and gathers in the ring.
  useEffect(() => {
    if (state !== "gather") return;
    let alive = true;
    const settle = () => {
      if (!alive) return;
      setClosed(true);
      onSettledRef.current?.();
    };
    if (!field || reducedMotion()) {
      field?.set({ beam: 0, pool: 0.55, tip: 0, gather: 0 });
      settle();
      return;
    }
    void (async () => {
      field.burst(0.6);
      field.set({ beam: 1, grow: 1, flow: -FLOW, tip: 0, wave: 0, gather: 0.001 });
      void field.to({ pool: 1.3 }, 2600, "in");
      await field.to({ gather: 1 }, 2600, "linear");
      if (!alive) return;
      // Gathered: the ring closes with a flash, a ring of light runs out, and the beam goes out.
      field.set({ gather: 0, wave: 0.001 });
      field.burst(0.9);
      setClosed(true);
      void field.to({ wave: 1 }, 900, "out").then(() => {
        if (alive) field.set({ wave: 0 });
      });
      await field.to({ beam: 0, pool: 0.55 }, 900, "inOut");
      settle();
    })();
    return () => {
      alive = false;
    };
  }, [state, field]);

  // Not played on the screen: the beam goes out and nothing comes back.
  useEffect(() => {
    if (state === "off" && first !== "off") void field?.to({ beam: 0, tip: 0, pool: 0.2 }, 900, "inOut");
  }, [state, first, field]);

  const turning = state === "send" || (state === "gather" && !closed);
  return (
    <div className="relay" aria-hidden="true">
      <div ref={ringRef} className={`relay__ring${turning ? " is-turning" : ""}${closed ? " is-closed" : ""}`}>
        <svg viewBox="0 0 120 120">
          <circle className="relay__track" cx="60" cy="60" r="56" />
          <circle className="relay__arc" cx="60" cy="60" r="56" />
        </svg>
      </div>
    </div>
  );
}
