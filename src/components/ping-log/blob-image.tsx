"use client";

/* eslint-disable @next/next/no-img-element -- the image is a local blob: URL */

import { useEffect, useRef } from "react";

/**
 * An image from a Blob kept on the phone. Its object URL is made and revoked
 * inside the effect, so React's development double run cannot revoke the URL
 * the image is showing.
 */
export function BlobImage({ blob, alt, className }: { blob: Blob; alt: string; className?: string }) {
  const ref = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  return <img ref={ref} alt={alt} className={className} />;
}
