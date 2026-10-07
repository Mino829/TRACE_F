"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  CAMPUS_OUTLINE,
  CAMPUS_SHEET,
  GEOFENCE_HULL,
  METRES_PER_PLAN_PX,
  NORTH_BEARING_DEG,
  buildingSheetRect,
  footprintCampusPx,
  localToCampusPx,
  planNormToCampusPx,
  type CampusPx,
} from "@/lib/geo/campus-georeference";
import { buildings } from "@/lib/map/buildings";

/**
 * The Toyosu campus as one pannable, pinchable drawing, for pointing at where
 * you stand.
 *
 * Every building's plate sits on one sheet at its surveyed place, so a point
 * on the deck or the paving between buildings can be marked too. The view is
 * driven by pointer events rather than a scrollbox, because a scrollbox
 * swallows the pinch, and markers are drawn in screen space and pinned to the
 * edge when they leave the view, never clipped away. The sheet is turned north
 * up by default: the buildings stand 43° off north, and in the field the
 * direction you face is what has to match.
 */

/** At 1.5 one screen pixel is 4 cm of ground; past that the plates have nothing more to show. */
const SCALE_LIMITS = { min: 0.04, max: 1.5 };
/** Above this the texture is mush, so the extracted walls carry the drawing. */
const WALLS_FROM_SCALE = 0.28;
/** A finger that moves less than this was pointing, not dragging. */
const TAP_SLOP_PX = 8;
const TAP_MS = 600;
const EDGE_PAD_PX = 22;
const TOOL_BUTTON = "rounded-full border border-neutral-300 bg-white/90 px-3 py-1 text-xs text-neutral-900 disabled:opacity-40";

interface View {
  scale: number;
  /** Screen position of the sheet's origin, after the turn. */
  x: number;
  y: number;
}

/**
 * How far the sheet is turned on screen, clockwise-positive degrees.
 * `NORTH_BEARING_DEG` is the true bearing of the drawing's up direction, so
 * turning the sheet clockwise by it brings north to vertical.
 */
function turnDeg(northUp: boolean): number {
  return northUp ? NORTH_BEARING_DEG : 0;
}

/** Sheet offset -> screen offset, the linear half of the view transform. */
function turn(dx: number, dy: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

interface Props {
  level: number;
  mark: CampusPx | null;
  onMarkChange: (px: CampusPx) => void;
  /** The phone's own fix. Left out on the participant screen, where it would pull the mark towards itself. */
  me: CampusPx | null;
  meAccuracyMetres: number | null;
}

interface Plate {
  id: string;
  name: string;
  rect: { x: number; y: number; width: number; height: number };
  texture: string;
  ghost: boolean;
  area: number;
  /** Slab outline, so the building reads as a shape when the line art does not. */
  outline: string;
  /** Extracted wall centrelines: the only part of the drawing that stays sharp. */
  walls: string;
}

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(SCALE_LIMITS.max, Math.max(SCALE_LIMITS.min, value));
}

/**
 * What each structure shows at this level. A building with no floor there is
 * still drawn, faintly, from its nearest plate: a campus that loses half its
 * buildings at 9F is harder to point at, not easier.
 */
function platesFor(level: number): Plate[] {
  return buildings
    .map((building): Plate => {
      const exact = building.floors.find((floor) => floor.level === level);
      const floor =
        exact ??
        building.floors.reduce((best, candidate) =>
          Math.abs(candidate.level - level) < Math.abs(best.level - level) ? candidate : best,
        );
      const rect = buildingSheetRect(building.id);
      return {
        id: building.id,
        name: building.name,
        rect,
        texture: floor.texture,
        ghost: !exact,
        area: rect.width * rect.height,
        outline: footprintCampusPx(building.id, floor.id)
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(" "),
        walls: floor.walls
          .map(([x1, z1, x2, z2]) => {
            const a = planNormToCampusPx(building.id, x1, z1);
            const b = planNormToCampusPx(building.id, x2, z2);
            return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
          })
          .join(""),
      };
    })
    .sort((a, b) => b.area - a.area);
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

const HULL_POINTS = GEOFENCE_HULL.map((vertex) => {
  const px = localToCampusPx(vertex);
  return `${px.x.toFixed(1)},${px.y.toFixed(1)}`;
}).join(" ");

export function CampusPlan({ level, mark, onMarkChange, me, meAccuracyMetres }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const tap = useRef<{ x: number; y: number; at: number; moved: boolean } | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>({ scale: 0.2, x: 0, y: 0 });
  const [northUp, setNorthUp] = useState(true);
  const degrees = turnDeg(northUp);
  const touched = useRef(false);
  const plates = useMemo(() => platesFor(level), [level]);

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // Measured here as well as observed: the observer's first callback is not
    // guaranteed, and without a size the fit does nothing.
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize((current) =>
        current.width === box.width && current.height === box.height ? current : { width: box.width, height: box.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(
    (width = size.width, height = size.height, degreesNow = degrees) => {
      if (width === 0 || height === 0) return;
      // Fitted to the drawn slabs, not to the sheet, which carries undrawn
      // ground on every side so the paving can be pointed at.
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const point of CAMPUS_OUTLINE) {
        const turned = turn(point.x - CAMPUS_SHEET.x, point.y - CAMPUS_SHEET.y, degreesNow);
        x0 = Math.min(x0, turned.x);
        x1 = Math.max(x1, turned.x);
        y0 = Math.min(y0, turned.y);
        y1 = Math.max(y1, turned.y);
      }
      const scale = clampScale(Math.min(width / (x1 - x0), height / (y1 - y0)) * 0.94);
      setView({
        scale,
        x: (width - (x1 - x0) * scale) / 2 - x0 * scale,
        y: (height - (y1 - y0) * scale) / 2 - y0 * scale,
      });
    },
    [size.width, size.height, degrees],
  );

  // Refit while the view is still ours (the viewport settles after fonts and
  // the address bar); once the person has panned or zoomed, it is theirs.
  useEffect(() => {
    if (touched.current || size.width === 0 || size.height === 0) return;
    fit(size.width, size.height);
  }, [size, fit]);

  const screenOf = useCallback(
    (px: CampusPx) => {
      const offset = turn(px.x - CAMPUS_SHEET.x, px.y - CAMPUS_SHEET.y, degrees);
      return { x: offset.x * view.scale + view.x, y: offset.y * view.scale + view.y };
    },
    [view, degrees],
  );

  const sheetOf = useCallback(
    (point: { x: number; y: number }): CampusPx => {
      const offset = turn((point.x - view.x) / view.scale, (point.y - view.y) / view.scale, -degrees);
      return { x: offset.x + CAMPUS_SHEET.x, y: offset.y + CAMPUS_SHEET.y };
    },
    [view, degrees],
  );

  /** Zoom about a screen point, so what is under the fingers stays under them. */
  const zoomAbout = useCallback((factor: number, anchor: { x: number; y: number }) => {
    touched.current = true;
    setView((current) => {
      const scale = clampScale(current.scale * factor);
      const applied = scale / current.scale;
      return { scale, x: anchor.x - (anchor.x - current.x) * applied, y: anchor.y - (anchor.y - current.y) * applied };
    });
  }, []);

  const centreOn = useCallback(
    (px: CampusPx) => {
      touched.current = true;
      setView((current) => {
        const offset = turn(px.x - CAMPUS_SHEET.x, px.y - CAMPUS_SHEET.y, degrees);
        return { scale: current.scale, x: size.width / 2 - offset.x * current.scale, y: size.height / 2 - offset.y * current.scale };
      });
    },
    [size.width, size.height, degrees],
  );

  // React's onWheel is passive, so preventDefault there would let the page scroll.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomAbout(Math.exp(-event.deltaY * 0.0016), { x: event.clientX - box.left, y: event.clientY - box.top });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAbout]);

  const local = (event: React.PointerEvent) => {
    const box = viewport.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // Capture keeps a finger that slides off the viewport driving the gesture;
    // a browser that refuses it must not lose the gesture with it.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already gone, or not capturable here */
    }
    touched.current = true;
    const point = local(event);
    pointers.current.set(event.pointerId, point);
    tap.current = pointers.current.size === 1 ? { ...point, at: Date.now(), moved: false } : null;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event);
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, point);
    const after = [...pointers.current.values()];

    if (after.length === 1) {
      const dx = after[0].x - before[0].x;
      const dy = after[0].y - before[0].y;
      if (tap.current && distance(point, tap.current) > TAP_SLOP_PX) tap.current.moved = true;
      setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
      return;
    }

    // Two fingers carry both the zoom and the pan: the point between them stays put.
    const previousSpan = distance(before[0], before[1]);
    const currentSpan = distance(after[0], after[1]);
    if (previousSpan === 0) return;
    const previousMid = midpoint(before[0], before[1]);
    const currentMid = midpoint(after[0], after[1]);
    setView((current) => {
      const scale = clampScale(current.scale * (currentSpan / previousSpan));
      const applied = scale / current.scale;
      return { scale, x: currentMid.x - (previousMid.x - current.x) * applied, y: currentMid.y - (previousMid.y - current.y) * applied };
    });
  };

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = local(event);
    pointers.current.delete(event.pointerId);
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* nothing to release */
    }
    const candidate = tap.current;
    tap.current = null;
    if (!candidate || candidate.moved || pointers.current.size > 0) return;
    if (Date.now() - candidate.at > TAP_MS || distance(point, candidate) > TAP_SLOP_PX) return;
    const sheet = sheetOf(point);
    onMarkChange({
      x: Math.min(CAMPUS_SHEET.x + CAMPUS_SHEET.width, Math.max(CAMPUS_SHEET.x, sheet.x)),
      y: Math.min(CAMPUS_SHEET.y + CAMPUS_SHEET.height, Math.max(CAMPUS_SHEET.y, sheet.y)),
    });
  };

  /** A marker off the viewport is pinned to the edge it left by, with how far away it is. */
  const pin = (px: CampusPx) => {
    const point = screenOf(px);
    const x = Math.min(size.width - EDGE_PAD_PX, Math.max(EDGE_PAD_PX, point.x));
    const y = Math.min(size.height - EDGE_PAD_PX, Math.max(EDGE_PAD_PX, point.y));
    const centre = sheetOf({ x: size.width / 2, y: size.height / 2 });
    return {
      x,
      y,
      off: x !== point.x || y !== point.y,
      metres: distance(px, centre) * METRES_PER_PLAN_PX,
      // The label hangs off whichever side of the pin has room.
      chip: [x > size.width / 2 ? "right-[-9px]" : "left-[-9px]", y > size.height - 44 ? "bottom-1/2 mb-3" : "top-1/2 mt-3"].join(" "),
    };
  };

  const mePin = me ? pin(me) : null;
  const markPin = mark ? pin(mark) : null;
  const accuracyPx = meAccuracyMetres === null ? null : meAccuracyMetres / METRES_PER_PLAN_PX;
  const chipBase = "absolute whitespace-nowrap rounded-full bg-neutral-900/90 px-2 font-mono text-[10px] leading-5 text-white";

  return (
    <div className="space-y-2">
      <div
        className="relative h-[min(56vh,480px)] cursor-crosshair touch-none overflow-hidden overscroll-contain rounded-md border border-neutral-300 bg-neutral-100 select-none dark:border-neutral-700"
        ref={viewport}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        role="presentation"
      >
        {/* The sheet has no box of its own: Chromium will not rasterize a
            turned element this large, so everything hangs off a zero-sized
            origin. One SVG holds slabs, plates and marks, which fixes their
            paint order and avoids blank <img> plates inside a turned parent. */}
        <div
          className="absolute top-0 left-0 h-0 w-0 origin-top-left"
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) rotate(${degrees}deg) scale(${view.scale})` }}
        >
          <svg
            className="pointer-events-none absolute top-0 left-0"
            width={CAMPUS_SHEET.width}
            height={CAMPUS_SHEET.height}
            viewBox={`${CAMPUS_SHEET.x} ${CAMPUS_SHEET.y} ${CAMPUS_SHEET.width} ${CAMPUS_SHEET.height}`}
            aria-hidden="true"
          >
            <polygon points={HULL_POINTS} fill="none" stroke="rgba(0,0,0,.3)" strokeWidth={1.5} strokeDasharray="10 8" vectorEffect="non-scaling-stroke" />
            {plates.map((plate) => (
              <polygon
                key={plate.id}
                points={plate.outline}
                fill={plate.ghost ? "rgba(255,255,255,.5)" : "#fff"}
                stroke={plate.ghost ? "rgba(0,0,0,.15)" : "rgba(0,0,0,.5)"}
                strokeWidth={1.4}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {plates.map((plate) => (
              <image
                key={plate.id}
                href={plate.texture}
                x={plate.rect.x}
                y={plate.rect.y}
                width={plate.rect.width}
                height={plate.rect.height}
                opacity={plate.ghost ? 0.16 : 1}
                preserveAspectRatio="none"
              />
            ))}
            {view.scale > WALLS_FROM_SCALE &&
              plates
                .filter((plate) => !plate.ghost)
                .map((plate) => (
                  <path key={plate.id} d={plate.walls} fill="none" stroke="rgba(38,38,38,.85)" strokeWidth={1.1} strokeLinecap="square" vectorEffect="non-scaling-stroke" />
                ))}
            {me && accuracyPx !== null && (
              <circle cx={me.x} cy={me.y} r={accuracyPx} fill="rgba(0,0,0,.08)" stroke="rgba(0,0,0,.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            )}
            {/* Labels only where there is room; the plates overlap. */}
            {plates
              .filter((plate) => !plate.ghost && plate.rect.width * view.scale > 90)
              .map((plate) => (
                <text
                  key={plate.id}
                  x={plate.rect.x + plate.rect.width / 2}
                  y={plate.rect.y + plate.rect.height / 2}
                  fontSize={12 / view.scale}
                  fill="rgba(0,0,0,.45)"
                  fontWeight={700}
                  textAnchor="middle"
                  transform={`rotate(${-degrees} ${plate.rect.x + plate.rect.width / 2} ${plate.rect.y + plate.rect.height / 2})`}
                >{plate.name}</text>
              ))}
          </svg>
        </div>

        <div className="absolute right-2 bottom-2 left-2 z-10 flex flex-wrap items-center gap-1.5" onPointerDown={(event) => event.stopPropagation()}>
          <button className={TOOL_BUTTON} type="button" onClick={() => zoomAbout(1 / 1.6, { x: size.width / 2, y: size.height / 2 })} aria-label="縮小">−</button>
          <button className={TOOL_BUTTON} type="button" onClick={() => zoomAbout(1.6, { x: size.width / 2, y: size.height / 2 })} aria-label="拡大">＋</button>
          <button
            className={TOOL_BUTTON}
            type="button"
            onClick={() => {
              const next = !northUp;
              setNorthUp(next);
              fit(size.width, size.height, turnDeg(next));
            }}
          >{northUp ? "北が上" : "図面の向き"}</button>
          <button className={TOOL_BUTTON} type="button" onClick={() => fit()}>全体</button>
          {me && <button className={TOOL_BUTTON} type="button" onClick={() => centreOn(me)}>測った位置</button>}
        </div>

        <div className="pointer-events-none absolute top-2.5 right-2.5 grid size-8 place-items-center rounded-full border border-neutral-300 bg-white/80" aria-hidden="true">
          <svg viewBox="-14 -14 28 28" className="absolute size-6" style={{ transform: `rotate(${degrees - NORTH_BEARING_DEG}deg)` }}>
            <line x1="0" y1="10" x2="0" y2="-9" stroke="rgba(0,0,0,.45)" strokeWidth={1.5} />
            <polygon points="0,-13 4,-5 -4,-5" fill="#171717" />
          </svg>
          <span className="absolute bottom-px font-sans text-[8px] font-bold text-neutral-500">N</span>
        </div>

        {mePin && (
          <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: mePin.x, top: mePin.y }}>
            <span className={`block size-3.5 border-2 border-white bg-neutral-500 shadow ${mePin.off ? "rotate-45 rounded-sm" : "rounded-full"}`} />
            {mePin.off && (
              <span className={`${chipBase} ${mePin.chip}`}>
                測った位置 {mePin.metres < 1000 ? `${Math.round(mePin.metres)}m` : `${(mePin.metres / 1000).toFixed(1)}km`}
              </span>
            )}
          </div>
        )}

        {markPin && (
          <div className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: markPin.x, top: markPin.y }}>
            <svg width="46" height="46" viewBox="-23 -23 46 46" className={`block overflow-visible ${markPin.off ? "opacity-50" : ""}`} aria-hidden="true">
              <line x1="0" y1="-21" x2="0" y2="21" stroke="#171717" strokeWidth={1.6} />
              <line x1="-21" y1="0" x2="21" y2="0" stroke="#171717" strokeWidth={1.6} />
              <circle cx="0" cy="0" r="6" stroke="#171717" strokeWidth={1.6} fill="none" />
            </svg>
            {markPin.off && <span className={`${chipBase} ${markPin.chip}`}>指した場所 {Math.round(markPin.metres)}m</span>}
          </div>
        )}
      </div>
      <p className="text-xs text-neutral-500">
        1本指で移動、2本指で拡大と縮小ができます。いまいる場所をタップしてください。
        {me && "灰色の点はスマホが測った位置、円はその誤差の目安です。"}
      </p>
    </div>
  );
}
