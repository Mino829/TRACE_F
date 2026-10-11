import { useEffect, useRef } from "react";

/** The layer entry this page pushed and has not left yet; a layer remounted under it (a retaken photo) reuses it. */
let pushedHash: string | null = null;

/**
 * A full-screen layer over the page (the photo flow, the clear screen, the
 * demo). While it is open the page behind it does not scroll, and the phone's
 * back button closes it: opening pushes a history entry under `hash`, and
 * going back pops it. The returned close() leaves the same way, so the entry
 * does not linger.
 */
export function useLayer(hash: string, onBack: () => void): () => void {
  const onBackRef = useRef(onBack);
  const closing = useRef(false);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (window.location.hash !== hash || pushedHash !== hash) {
      // The same hash left by a reload is not this page's entry: going back to it would not close the layer.
      if (window.location.hash === hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
      window.history.pushState(null, "", hash);
      pushedHash = hash;
    }
    const onPop = () => {
      pushedHash = null;
      if (!closing.current) onBackRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = overflow;
    };
  }, [hash]);

  return () => {
    closing.current = true;
    pushedHash = null;
    if (window.location.hash === hash) window.history.back();
    onBackRef.current();
  };
}
