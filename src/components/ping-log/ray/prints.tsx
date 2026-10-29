"use client";

/* eslint-disable @next/next/no-img-element -- photos are local blob: URLs or the demo's own files */

import { Children, useEffect, useRef, useState, type ReactNode } from "react";

import { RayPrint, reducedMotion } from "@/lib/ray/fx";

import { useRay } from "./stage";

/**
 * Photos as prints. The photo is an <img> in its own colours; a pixel copy on
 * a canvas above it shows only while it tears.
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

/** The photo and its tearing copy, filling the box it is put in. */
export function PrintPhoto({ source, alt }: { source: PhotoSource; alt: string }) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const printRef = useRef<RayPrint | null>(null);
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
        <PrintPhoto source={source} alt={`${time} の写真`} />
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

/**
 * Photos side by side, snapping one at a time. A fast swipe tears the field
 * and the photos. Below them, one dash per photo marks the one in view (#52).
 */
export function Strip({ children, label, one }: { children: ReactNode; label: string; one: boolean }) {
  const { field } = useRay();
  const ref = useRef<HTMLUListElement>(null);
  const total = Children.count(children);
  const [at, setAt] = useState(0);

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

  // The photo nearest the middle is the one in view; read once a frame while scrolling.
  useEffect(() => {
    const strip = ref.current;
    if (!strip || one) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = strip.getBoundingClientRect();
      const middle = box.left + box.width / 2;
      let nearest = 0;
      let best = Infinity;
      Array.from(strip.children).forEach((child, index) => {
        const rect = child.getBoundingClientRect();
        const distance = Math.abs(rect.left + rect.width / 2 - middle);
        if (distance < best) {
          best = distance;
          nearest = index;
        }
      });
      setAt(nearest);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    frame = requestAnimationFrame(measure);
    strip.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      strip.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [one, total]);

  // Focusable, so the arrow keys can scroll it too. Each photo's caption already says which it is, so the dashes are for the eye only.
  return (
    <>
      <ul ref={ref} className={`strip${one ? " strip--one" : ""}`} aria-label={label} tabIndex={0}>
        {children}
      </ul>
      {!one && (
        <div className="strip__at" aria-hidden="true">
          {Array.from({ length: total }, (_, index) => (
            <i key={index} className={index === Math.min(at, total - 1) ? "is-at" : undefined} />
          ))}
        </div>
      )}
    </>
  );
}
