"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Trying out how the paper moves, for the team: ?tweaks= on the URL picks one
 * of three ways the background lives, and whether a tap leaves a soft light,
 * and puts a small panel at the edge of the phone to switch them while
 * looking. Without the parameter the page uses DEFAULT_TWEAKS and shows no
 * panel.
 *
 *   /log?tweaks              the panel, with the defaults
 *   /log?tweaks=sun          sunlight through a window, over all the paper
 *   /log?tweaks=window       the light moves inside the frames only
 *   /log?tweaks=depth,touch  the hairlines and the clock lie further back
 *
 * None of them puts dots behind text: sun is a soft tonal light, window keeps
 * its dither inside the frames, depth moves only while the screen scrolls.
 */

export type Motion = "still" | "sun" | "window" | "depth";
export type Tweaks = { motion: Motion; touch: boolean };

export const MOTIONS: { key: Motion; label: string }[] = [
  { key: "still", label: "なし" },
  { key: "sun", label: "日だまり" },
  { key: "window", label: "光の窓" },
  { key: "depth", label: "奥行き" },
];

export const DEFAULT_TWEAKS: Tweaks = { motion: "sun", touch: false };

function parse(value: string): Tweaks {
  const words = value.split(/[,+\s]/).filter(Boolean);
  const motion = MOTIONS.find((item) => words.includes(item.key))?.key ?? DEFAULT_TWEAKS.motion;
  const touch = words.includes("touch") ? true : words.includes("notouch") ? false : DEFAULT_TWEAKS.touch;
  return { motion, touch };
}

function serialize(tweaks: Tweaks): string {
  return [tweaks.motion, tweaks.touch ? "touch" : "notouch"].join(",");
}

/** The choice on the URL, and whether the panel shows: only while ?tweaks is there. */
export function useTweaks(): { tweaks: Tweaks; panel: boolean; change: (next: Tweaks) => void } {
  const [state] = useState(() => {
    const value = new URLSearchParams(window.location.search).get("tweaks");
    return { panel: value !== null, initial: value ? parse(value) : DEFAULT_TWEAKS };
  });
  const [tweaks, setTweaks] = useState<Tweaks>(state.initial);

  const change = (next: Tweaks) => {
    setTweaks(next);
    // Kept on the URL, so a reload or a shared link shows the same.
    const url = new URL(window.location.href);
    url.searchParams.set("tweaks", serialize(next));
    window.history.replaceState(window.history.state, "", url.pathname + url.search.replace(/%2C/g, ",") + url.hash);
  };

  return { tweaks, panel: state.panel, change };
}

export function TweaksPanel({ tweaks, onChange }: { tweaks: Tweaks; onChange: (next: Tweaks) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const label = MOTIONS.find((item) => item.key === tweaks.motion)?.label ?? "";
  return (
    <div ref={ref} className={`tweaks${open ? " is-open" : ""}`}>
      {open && (
        <div className="tweaks__panel" id={id} role="group" aria-label="背景の動き（確認用）">
          <p className="mono">Tweaks</p>
          <fieldset>
            <legend className="small">背景の動き</legend>
            <div className="tweaks__opts">
              {MOTIONS.map((item) => (
                <button key={item.key} type="button" aria-pressed={tweaks.motion === item.key} onClick={() => onChange({ ...tweaks, motion: item.key })}>
                  {item.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="small">タップした所をほのかに明るく</legend>
            <div className="tweaks__opts">
              <button type="button" aria-pressed={!tweaks.touch} onClick={() => onChange({ ...tweaks, touch: false })}>
                なし
              </button>
              <button type="button" aria-pressed={tweaks.touch} onClick={() => onChange({ ...tweaks, touch: true })}>
                あり
              </button>
            </div>
          </fieldset>
        </div>
      )}
      <button type="button" className="tweaks__chip mono" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        Tweaks · {label}
      </button>
    </div>
  );
}
