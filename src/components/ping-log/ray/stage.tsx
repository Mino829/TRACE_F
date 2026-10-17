"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";

import { RayField, type FieldProps } from "@/lib/ray/field";
import { RayFX, reducedMotion } from "@/lib/ray/fx";

import { Phrases, Sentences } from "../ui";
import { TweaksPanel, useTweaks } from "./tweaks";

/**
 * The stage every RAY screen stands on: the phone-wide column, the field of
 * light behind it, the HUD, the toast, and the shutter and tear canvases
 * above it. Screens reach the field and the effects through useRay().
 */

export const PAPER = "#d3d5d3";
export const INK = "#0c0c0d";
export const SWAP = "#dfe1e0";

export type FieldMode = "day" | "room";
export type Scene = "title" | "scan";

type Ray = {
  field: RayField | null;
  fx: RayFX | null;
  /** Hides a screen change behind the shutter; under reduced motion it is a cut. */
  go: (change: () => void) => Promise<void>;
  toast: (text: string) => void;
  setMode: (mode: FieldMode, scene?: Scene) => void;
  mode: FieldMode;
  /** Whether the light inside a window keeps moving (光の窓). */
  drift: boolean;
};

const RayContext = createContext<Ray | null>(null);

export function useRay(): Ray {
  const ray = useContext(RayContext);
  if (!ray) throw new Error("useRay() outside <RayStage>");
  return ray;
}

/** Plain paper: the field of every day screen. A window's light is LightWindow's own. */
export const DAY: FieldProps = { scene: 0, splitOn: 0, invert: 0 };
/** Plain ink: the reading screens in the room. */
export const ROOM: FieldProps = { scene: 0, splitOn: 0, invert: 1, sun: 0.4 };

/** The light moves with the day: low from the east in the morning, from the west by five. */
export function sunAngle(now = Date.now()): number {
  const date = new Date(now);
  const hours = date.getHours() + date.getMinutes() / 60;
  const t = Math.min(1, Math.max(0, (hours - 9) / 8));
  return 2.95 + (0.15 - 2.95) * t;
}

/** The 54th Shibaura Festival: Day 1 on 31 October 2026, Day 2 on 1 November; on other days, its dates. */
function festivalLabel(now: number): string {
  const date = new Date(now);
  const on = (month: number, day: number) => date.getFullYear() === 2026 && date.getMonth() === month - 1 && date.getDate() === day;
  return on(10, 31) ? "Fes.54 Day 1" : on(11, 1) ? "Fes.54 Day 2" : "Fes.54 10.31–11.01";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** The time, kept current at the given step. */
export function useNow(step: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), step);
    return () => window.clearInterval(timer);
  }, [step]);
  return now;
}

function Hud({ mode }: { mode: FieldMode }) {
  const now = useNow(1000);
  const date = new Date(now);
  return (
    <div className="hud" aria-hidden="true">
      <i className="hud__c hud__c--tl" />
      <i className="hud__c hud__c--tr" />
      <i className="hud__c hud__c--bl" />
      <i className="hud__c hud__c--br" />
      <p className="hud__read">
        <span>{mode === "room" ? "Trace / ShibaLab 301" : `Trace / ${festivalLabel(now)}`}</span>
        <span>
          {pad(date.getHours())}:{pad(date.getMinutes())}:{pad(date.getSeconds())}
        </span>
      </p>
    </div>
  );
}

/**
 * 日だまり: the sunlight from a window, four panes and the soft shadow of their
 * frame, lying on the paper. It brightens the paper and leaves the ink as it
 * is, so text on it only gains contrast. It shifts slowly, and every half a
 * minute or so a cloud dims it for a few seconds. It lies on the side the sun
 * is on by the phone's clock, read before its first frame, so it never shows
 * anywhere else first.
 */
function Daylight() {
  const side = Math.cos(sunAngle(useNow(300_000)));
  return (
    <div className="daylight" aria-hidden="true" style={{ "--sun-side": side.toFixed(3) } as CSSProperties}>
      <div className="daylight__drift">
        <div className="daylight__panes">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}

/** 奥行き: the time in large faint type, at the back with the hairlines. */
function DepthClock() {
  const date = new Date(useNow(15_000));
  return (
    <p className="depth-clock" aria-hidden="true">
      {pad(date.getHours())}:{pad(date.getMinutes())}
    </p>
  );
}

export function RayStage({ children, overlay }: { children: ReactNode; overlay?: ReactNode }) {
  const phoneRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLCanvasElement>(null);
  const shutterRef = useRef<HTMLCanvasElement>(null);
  const tearRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<{ field: RayField; fx: RayFX } | null>(null);
  const [mode, setModeState] = useState<FieldMode>("day");
  const [scene, setScene] = useState<Scene | undefined>(undefined);
  const [toastText, setToastText] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const busy = useRef(false);
  const { tweaks, panel, change } = useTweaks();

  useEffect(() => {
    const phone = phoneRef.current;
    if (!phone || !fieldRef.current || !shutterRef.current || !tearRef.current) return;
    const field = new RayField(fieldRef.current, phone, 2);
    const fx = new RayFX(phone, shutterRef.current, tearRef.current, 2);
    field.set({ sun: sunAngle() });
    setEngine({ field, fx });
    return () => {
      field.dispose();
      fx.dispose();
      setEngine(null);
    };
  }, []);

  const motion = tweaks.motion;

  // 奥行き: as a screen scrolls, the hairlines and the clock follow slower and a little late, so they seem
  // to lie further back. Nothing moves while the screen is still, and under reduced motion nothing moves.
  useEffect(() => {
    const phone = phoneRef.current;
    if (!phone || motion !== "depth") return;
    let target = 0;
    let current = 0;
    let raf = 0;
    let last = 0;
    const apply = () => {
      phone.style.setProperty("--near", `${(-(current * 0.4) % 78).toFixed(2)}px`);
      phone.style.setProperty("--far", `${(-current * 0.15).toFixed(2)}px`);
    };
    const step = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      current += (target - current) * (1 - Math.exp(-dt * 8));
      if (Math.abs(target - current) < 0.25) current = target;
      apply();
      raf = current === target ? 0 : requestAnimationFrame(step);
      if (!raf) last = 0;
    };
    const isPage = (node: EventTarget | null): node is HTMLElement => node instanceof HTMLElement && node.classList.contains("screen") && !node.classList.contains("overlay");
    const onScroll = (event: Event) => {
      if (!isPage(event.target) || reducedMotion()) return;
      target = event.target.scrollTop;
      if (!raf) raf = requestAnimationFrame(step);
    };
    // A new screen starts at its top, and so do the layers behind it.
    const onScreen = (event: Event) => {
      if (!isPage(event.target)) return;
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      target = 0;
      current = 0;
      apply();
    };
    phone.addEventListener("scroll", onScroll, { capture: true, passive: true });
    phone.addEventListener("ray:screen", onScreen);
    return () => {
      cancelAnimationFrame(raf);
      phone.removeEventListener("scroll", onScroll, { capture: true });
      phone.removeEventListener("ray:screen", onScreen);
      phone.style.removeProperty("--near");
      phone.style.removeProperty("--far");
    };
  }, [motion]);

  // A tap, not a scroll, leaves a soft light on the paper around the finger for a moment.
  const lightsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const phone = phoneRef.current;
    const lights = lightsRef.current;
    if (!phone || !lights || !tweaks.touch) return;
    let down: { x: number; y: number; at: number } | null = null;
    const onDown = (event: PointerEvent) => {
      down = event.isPrimary ? { x: event.clientX, y: event.clientY, at: event.timeStamp } : null;
    };
    const onUp = (event: PointerEvent) => {
      const tap = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 12 && event.timeStamp - down.at < 600;
      down = null;
      if (!tap || reducedMotion()) return;
      const box = phone.getBoundingClientRect();
      const light = document.createElement("i");
      light.className = "touchlight";
      light.style.left = `${event.clientX - box.left}px`;
      light.style.top = `${event.clientY - box.top}px`;
      lights.append(light);
      const fade = light.animate(
        [
          { opacity: 0, transform: "scale(0.6)" },
          { opacity: 1, transform: "scale(0.85)", offset: 0.2 },
          { opacity: 0, transform: "scale(1)" },
        ],
        { duration: 1100, easing: "cubic-bezier(0.25, 0.6, 0.3, 1)" },
      );
      fade.onfinish = () => light.remove();
      fade.oncancel = () => light.remove();
    };
    phone.addEventListener("pointerdown", onDown, { passive: true });
    phone.addEventListener("pointerup", onUp, { passive: true });
    return () => {
      phone.removeEventListener("pointerdown", onDown);
      phone.removeEventListener("pointerup", onUp);
      lights.replaceChildren();
    };
  }, [tweaks.touch]);

  // The browser's bar takes the field's own colour.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const before = meta.content;
    meta.content = mode === "room" || scene === "title" ? INK : PAPER;
    return () => {
      meta.content = before;
    };
  }, [mode, scene]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const setMode = useCallback((next: FieldMode, nextScene?: Scene) => {
    setModeState(next);
    setScene(nextScene);
  }, []);

  const go = useCallback(
    async (change: () => void) => {
      const fx = engine?.fx;
      if (!fx || reducedMotion() || busy.current) {
        change();
        return;
      }
      busy.current = true;
      // In the dark room the strips are a dim grey, so a screen change never flashes white.
      const color = phoneRef.current?.dataset.field === "room" ? "#3b3c3f" : INK;
      try {
        await fx.wipe(color, () => flushSync(change));
      } finally {
        busy.current = false;
      }
    },
    [engine],
  );

  const toast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToastText(text);
    setToastOn(true);
    toastTimer.current = window.setTimeout(() => setToastOn(false), 2600);
  }, []);

  const value = useMemo<Ray>(
    () => ({ field: engine?.field ?? null, fx: engine?.fx ?? null, go, toast, setMode, mode, drift: motion === "window" }),
    [engine, go, toast, setMode, mode, motion],
  );

  return (
    <RayContext.Provider value={value}>
      <div className="phone" ref={phoneRef} data-field={mode} data-scene={scene} data-motion={motion}>
        <canvas ref={fieldRef} className="field" aria-hidden="true" />
        <div className="sheet" aria-hidden="true" />
        {motion === "sun" && <Daylight />}
        {motion === "depth" && <DepthClock />}
        <div ref={lightsRef} className="touchlights" aria-hidden="true" />
        {children}
        <div className={`toast${toastOn ? " is-on" : ""}`} role="status">
          {toastText}
        </div>
        {overlay}
        <Hud mode={mode} />
        {panel && <TweaksPanel tweaks={tweaks} onChange={change} />}
        <canvas ref={shutterRef} className="fx fx--shutter" aria-hidden="true" />
        <canvas ref={tearRef} className="fx fx--tear" aria-hidden="true" />
      </div>
    </RayContext.Provider>
  );
}

/** Sets the field for a screen while it is up: its mode (day or room), its scene, and the field's values. */
export function useField(mode: FieldMode, values: FieldProps, scene?: Scene): void {
  const { field, setMode } = useRay();
  const key = JSON.stringify(values);
  useEffect(() => {
    setMode(mode, scene);
    field?.set(JSON.parse(key) as FieldProps);
  }, [field, setMode, mode, scene, key]);
}

const ScrollerContext = createContext<RefObject<HTMLElement | null> | null>(null);

/**
 * One screen: it scrolls on its own, starts at its top, and hands its heading
 * the focus so a screen reader starts at the new screen.
 */
export function Screen({
  className = "",
  children,
  inert = false,
  label,
}: {
  className?: string;
  children: ReactNode;
  inert?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.scrollTo(0, 0);
    const heading = ref.current?.querySelector<HTMLElement>("h1, h2");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, []);
  // A new screen starts at its top, and so do the layers behind it (RayStage, 奥行き).
  useEffect(() => {
    ref.current?.dispatchEvent(new Event("ray:screen", { bubbles: true }));
  }, []);
  return (
    <ScrollerContext.Provider value={ref}>
      <section ref={ref} className={`screen ${className}`} inert={inert} aria-label={label}>
        {children}
      </section>
    </ScrollerContext.Provider>
  );
}

export function useScroller(): RefObject<HTMLElement | null> | null {
  return useContext(ScrollerContext);
}

/**
 * A window of light: the paper's sunlight inside a box. The light comes up
 * when the box appears; sweep swings it in from the side first.
 *
 * The box draws the light on a canvas of its own, so the light scrolls with
 * the box. Drawn on the field behind the screen instead, it trails every
 * scroll on an iPhone, where the page scrolls apart from the script, and its
 * dots land on the text around the box. The canvas prints only the ink: its
 * paper is white and multiplies, so the paper under it, sunlit or not, shows
 * through unchanged.
 */
export function LightWindow({ className, soft = 0, sweep = false }: { className: string; soft?: number; sweep?: boolean }) {
  const { drift } = useRay();
  const ref = useRef<HTMLDivElement>(null);
  const light = useRef<RayField | null>(null);
  const drifting = useRef(drift);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const canvas = document.createElement("canvas");
    canvas.className = "lightwindow__field";
    box.prepend(canvas);
    const field = new RayField(canvas, box, 2);
    light.current = field;
    // The field sizes its canvas first, then the window is framed on it.
    const frame = () => field.window(box.getBoundingClientRect(), soft);
    const observer = new ResizeObserver(frame);
    observer.observe(box);
    frame();
    const sun = sunAngle();
    field.set({ ...DAY, paper: [1, 1, 1], drift: drifting.current ? 1 : 0, glow: 0, bands: 0, sun: sweep ? sun + 0.8 : sun });
    void field.to({ glow: 1.75, bands: 0.82 }, 1400, "out");
    if (sweep) void field.to({ sun }, 2200, "out");
    return () => {
      observer.disconnect();
      field.dispose(true);
      canvas.remove();
      light.current = null;
    };
  }, [soft, sweep]);

  useEffect(() => {
    drifting.current = drift;
    light.current?.set({ drift: drift ? 1 : 0 });
  }, [drift]);

  return <div ref={ref} className={`lightwindow ${className}`} aria-hidden="true" />;
}

/* ------------------------------------------------------------------ parts */

/** Whether a sticky box at the foot of its screen is being held there, with the page scrolling under it. */
function useStuck(box: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const element = box.current;
    const screen = element?.closest<HTMLElement>(".screen");
    if (!active || !element || !screen) return;
    // Held, the box's foot sits a pixel below this line; in its own place, above it.
    const line = parseFloat(getComputedStyle(screen).paddingBottom) + parseFloat(getComputedStyle(element).bottom) + 1;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(entry.intersectionRatio < 1 && !!entry.rootBounds && entry.boundingClientRect.bottom > entry.rootBounds.bottom),
      { root: screen, rootMargin: `0px 0px ${-line}px 0px`, threshold: 1 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [box, active]);
  return active && stuck;
}

/**
 * The foot of a long screen, for its button: while the page scrolls, the
 * button waits just above the readout on a ground of its own, then settles
 * in its place. Not sticky, it simply stands in its place.
 */
export function Dock({ sticky = true, children }: { sticky?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const stuck = useStuck(ref, sticky);
  return (
    <div ref={ref} className={`dockbar${sticky ? " is-sticky" : ""}${stuck ? " is-stuck" : ""}`}>
      {children}
    </div>
  );
}

const ICONS = {
  camera: (
    <>
      <path d="M3 7.5h4.2l2-3h5.6l2 3H21V20H3z" />
      <circle cx="12" cy="13.5" r="3.6" />
    </>
  ),
  qr: (
    <>
      <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3z" />
      <path d="M14 14h3v3h-3zM18 18h3v3h-3zM20 14h1M14 20h1" />
    </>
  ),
  bell: (
    <>
      <path d="M6 17v-6a6 6 0 0 1 12 0v6l2 2H4z" />
      <path d="M10 21.5h4" />
    </>
  ),
  menu: <path d="M3 6.5h18M3 12h18M3 17.5h18" />,
  close: <path d="M5 5l14 14M19 5 5 19" />,
  arrow: <path d="M3.5 12h16M13.5 6l6 6-6 6" />,
  check: <path d="M4 12.5l5 5L20 6.5" />,
  share: (
    <>
      <path d="M12 3.5v11M7.5 8 12 3.5 16.5 8" />
      <path d="M5 11.5V21h14v-9.5" />
    </>
  ),
  plus: <path d="M3.5 3.5h17v17h-17zM12 8v8M8 12h8" />,
  download: (
    <>
      <path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5" />
      <path d="M4 20h16" />
    </>
  ),
  copy: (
    <>
      <path d="M8 8h12v12H8z" />
      <path d="M4 16V4h12" />
    </>
  ),
};

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/**
 * The wordmark, which leads home, and the developer and menu buttons. On
 * home itself the wordmark takes the screen back to its top.
 */
export function Mast({ extra, onHome, onDeveloper, onMenu }: { extra?: ReactNode; onHome?: () => void; onDeveloper: () => void; onMenu: () => void }) {
  return (
    <header className="mast">
      <div className="mast__mark">
        <HomeMark onHome={onHome} />
        {extra}
      </div>
      <MastButtons onDeveloper={onDeveloper} onMenu={onMenu} />
    </header>
  );
}

export function HomeMark({ onHome }: { onHome?: () => void }) {
  const toTop = (button: HTMLElement) => button.closest(".screen")?.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
  return (
    <button type="button" className="wordmark" aria-label="TRACE（ホーム）" onClick={(event) => (onHome ? onHome() : toTop(event.currentTarget))}>
      TRACE
    </button>
  );
}

export function MastButtons({ onDeveloper, onMenu }: { onDeveloper: () => void; onMenu: () => void }) {
  return (
    <div className="mast__right">
      <button type="button" className="mast__dev" onClick={onDeveloper}>
        開発者
      </button>
      <button type="button" className="icon-btn" aria-label="メニュー" aria-haspopup="dialog" onClick={onMenu}>
        <Icon name="menu" />
      </button>
    </div>
  );
}

const INFO_OPENED = "ray:info-opened";

/**
 * An "i" mark and the note it opens. One note is open at a time: opening
 * another, a tap anywhere outside the note, or Escape closes it.
 */
export function useInfo() {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // The mark's own tap is left to its click, which closes the note.
    const onDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (document.getElementById(markId(id))?.contains(target) || document.getElementById(id)?.contains(target))) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onOther = (event: Event) => {
      if (event instanceof CustomEvent && event.detail !== id) close();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    document.addEventListener(INFO_OPENED, onOther);
    document.dispatchEvent(new CustomEvent(INFO_OPENED, { detail: id }));
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener(INFO_OPENED, onOther);
    };
  }, [open, id]);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  return { open, id, toggle };
}

/** The "i" button's id, from its note's. */
function markId(id: string): string {
  return `${id}-mark`;
}

type InfoState = ReturnType<typeof useInfo>;

/**
 * The "i" beside a label: an 18px square to see, a 44px square to tap. A word
 * joiner ties it to the word before, so it never wraps onto a line alone.
 */
export function Info({ info, label }: { info: InfoState; label: string }) {
  return (
    <>
      {"⁠"}
      <button id={markId(info.id)} type="button" className="info" aria-expanded={info.open} aria-controls={info.id} aria-label={label} onClick={info.toggle}>
        <span aria-hidden="true">i</span>
      </button>
    </>
  );
}

/**
 * The note an "i" opens. It floats just below the mark, over what comes
 * next, so nothing on the screen moves when it opens, and its point sits
 * under the mark wherever the line has put it. Near the foot of the screen,
 * the screen scrolls it into view.
 */
export function Pop({ info, text }: { info: InfoState; text: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const { open, id } = info;

  useLayoutEffect(() => {
    const at = anchor.current;
    const box = document.getElementById(id);
    const button = document.getElementById(markId(id));
    const mark = button?.firstElementChild ?? button;
    if (!open || !at || !box || !mark) return;
    const place = () => {
      const base = at.getBoundingClientRect();
      const spot = mark.getBoundingClientRect();
      const tip = Math.min(Math.max(spot.left + spot.width / 2 - base.left - 6, 10), base.width - 22);
      box.style.setProperty("--tip", `${tip.toFixed(1)}px`);
      box.style.setProperty("top", `${(spot.bottom - base.top + 9).toFixed(1)}px`);
    };
    place();
    const screen = at.closest(".screen");
    if (screen) {
      const below = box.getBoundingClientRect().bottom - (screen.getBoundingClientRect().bottom - 64);
      if (below > 0) screen.scrollBy({ top: below, behavior: reducedMotion() ? "auto" : "smooth" });
    }
    const observer = new ResizeObserver(place);
    observer.observe(at);
    if (mark.parentElement) observer.observe(mark.parentElement);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open, id]);

  return (
    <div ref={anchor} className="pop-at">
      <div className="pop" id={id} role="note" hidden={!open}>
        <Sentences text={text} />
      </div>
    </div>
  );
}

/** OFF / ON. The active side inverts. */
export function Seg({ on, label, labelledBy, disabled, onToggle }: { on: boolean; label?: string; labelledBy?: string; disabled?: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="seg" role="switch" aria-checked={on} aria-label={label} aria-labelledby={labelledBy} disabled={disabled} onClick={onToggle}>
      <span className={`seg__o${on ? "" : " is-on"}`} aria-hidden="true">
        OFF
      </span>
      <span className={`seg__o${on ? " is-on" : ""}`} aria-hidden="true">
        ON
      </span>
    </button>
  );
}

/** CLEAR! in seven sheared slices that slide into place. */
export function ClearWord() {
  const [moving] = useState(() => !reducedMotion());
  const slices = 7;
  return (
    <>
      <div className="clearword" aria-hidden="true">
        {Array.from({ length: slices }, (_, i) => {
          const top = ((i / slices) * 100).toFixed(2);
          const bottom = (100 - ((i + 1) / slices) * 100).toFixed(2);
          const dx = (i % 2 ? 1 : -1) * (40 + ((i * 53) % 90));
          return (
            <span
              key={i}
              className={`clearword__s${moving ? " is-in" : ""}`}
              style={{ clipPath: `inset(${top}% 0 ${bottom}% 0)`, ["--dx" as string]: `${dx}px`, animationDelay: `${i * 34}ms` }}
            >
              CLEAR!
            </span>
          );
        })}
      </div>
      <p className="sr-only">CLEAR!</p>
    </>
  );
}

/** A note from the page: what just happened, or what went wrong. */
export function NoteBar({ text, alert = false }: { text: string; alert?: boolean }) {
  if (!text) return null;
  return (
    <p className="note-bar" role={alert ? "alert" : "status"}>
      <Sentences text={text} />
    </p>
  );
}

export { Phrases, Sentences };
