"use client";

/* eslint-disable @next/next/no-img-element -- photos are local blob: URLs or the demo's own files */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { RayPrint, reducedMotion } from "@/lib/ray/fx";

import { useRay } from "./stage";

/**
 * Photos as prints. The photo is an <img> in its own colours; a pixel copy on
 * a canvas above it shows only while it tears. The brightest point of the
 * photo carries the "RAY" mark, with no number: a value on each photo would
 * read as a score.
 */

/** Each mounted photo's tear, so a strip or a screen can tear the ones inside it. */
const TEARS = new WeakMap<Element, (ms: number, amount: number) => Promise<void>>();

export function tearAll(root: Element | null, ms: number, amount: number): void {
  root?.querySelectorAll("[data-print]").forEach((element) => void TEARS.get(element)?.(ms, amount));
}

export function tearOne(element: Element | null, ms: number, amount: number): Promise<void> {
  return (element && TEARS.get(element)?.(ms, amount)) || Promise.resolve();
}

/** Where a photo comes from: a Blob kept on the phone, or a file the page serves. */
export type PhotoSource = { blob: Blob } | { src: string };

/**
 * The photo and its tearing copy, filling the box it is put in. `mark` adds
 * the RAY mark at its brightest point.
 */
export function PrintPhoto({ source, alt, mark = false }: { source: PhotoSource; alt: string; mark?: boolean }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const printRef = useRef<RayPrint | null>(null);
  const [ray, setRay] = useState<{ x: number; y: number } | null>(null);
  const [tearing, setTearing] = useState(false);
  const blob = "blob" in source ? source.blob : null;
  const src = "src" in source ? source.src : null;

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    // A blob's URL is made and revoked here, so React's development double run cannot revoke the one in use.
    const url = blob ? URL.createObjectURL(blob) : src;
    if (!url) return;
    const ready = () => {
      const box = boxRef.current;
      const canvas = canvasRef.current;
      if (!box || !canvas || !img.naturalWidth) return;
      const rect = box.getBoundingClientRect();
      const print = new RayPrint(img, canvas, 2).fit(rect.width || 268, rect.height || 357);
      print.draw();
      printRef.current = print;
      setRay(print.ray);
    };
    img.addEventListener("load", ready);
    img.src = url;
    if (img.complete) ready();
    return () => {
      img.removeEventListener("load", ready);
      printRef.current = null;
      if (blob) URL.revokeObjectURL(url);
    };
  }, [blob, src]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    TEARS.set(box, async (ms, amount) => {
      const print = printRef.current;
      if (!print || reducedMotion()) return;
      setTearing(true);
      await print.tear(ms, amount);
      setTearing(false);
    });
    return () => {
      TEARS.delete(box);
    };
  }, []);

  return (
    <span ref={boxRef} data-print="" className={tearing ? "is-tear" : undefined} style={{ position: "absolute", inset: 0 }}>
      <img ref={imgRef} className="print__img" alt={alt} />
      <canvas ref={canvasRef} className="print__bits" aria-hidden="true" />
      {mark && ray && (
        <i
          className={`ray-mark${ray.x > 0.6 ? " ray-mark--l" : ""}`}
          style={{ left: `${(ray.x * 100).toFixed(1)}%`, top: `${(ray.y * 100).toFixed(1)}%` }}
          aria-hidden="true"
        />
      )}
    </span>
  );
}

/** Which photo of the day it is. */
export function frameLabel(number: number): string {
  return `${number}枚目`;
}

/** A print in a hairline frame, with which photo it is and its time below. */
export function Print({
  source,
  number,
  time,
  ratio,
  small = false,
  caption,
}: {
  source: PhotoSource;
  number: number;
  time: string;
  /** Width over height. */
  ratio: number;
  small?: boolean;
  caption?: ReactNode;
}) {
  return (
    <figure className={`print${small ? " print--small" : ""}${ratio > 1 ? " print--wide" : ""}`}>
      <span className="print__frame" style={{ ["--ratio" as string]: ratio }}>
        <PrintPhoto source={source} alt={`${time} の写真`} mark />
      </span>
      <figcaption className="print__cap">
        {caption ?? (
          <>
            <span>{frameLabel(number)}</span>
            <span>{time}</span>
          </>
        )}
      </figcaption>
    </figure>
  );
}

/** Photos side by side, snapping one at a time. A fast swipe tears the field and the photos. */
export function Strip({ children, label, one }: { children: ReactNode; label: string; one: boolean }) {
  const { field } = useRay();
  const ref = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    let last = strip.scrollLeft;
    let lastTime = performance.now();
    let lastTear = 0;
    const onScroll = () => {
      const now = performance.now();
      const velocity = ((strip.scrollLeft - last) / Math.max(8, now - lastTime)) * 16;
      last = strip.scrollLeft;
      lastTime = now;
      if (Math.abs(velocity) > 14 && now - lastTear > 260 && !reducedMotion()) {
        lastTear = now;
        field?.kick(velocity);
        tearAll(strip, 260, Math.min(1, Math.abs(velocity) / 40));
      }
    };
    strip.addEventListener("scroll", onScroll, { passive: true });
    return () => strip.removeEventListener("scroll", onScroll);
  }, [field]);

  // Focusable, so the arrow keys can scroll it too.
  return (
    <ul ref={ref} className={`strip${one ? " strip--one" : ""}`} aria-label={label} tabIndex={0}>
      {children}
    </ul>
  );
}
