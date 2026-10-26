"use client";

import { useEffect, useRef, useState } from "react";

import { COORDINATE_VERSION, CAMPUS_GRAPH_VERSION, THREE_D_MAP_VERSION } from "@/lib/display/campus-graph";
import { connectRendererLink, type ArrivalToPlay, type LinkState, type ReplayResult } from "@/lib/display/renderer-link";

import "./renderer-link.css";

/**
 * Where the booth's display WebSocket is: NEXT_PUBLIC_DISPLAY_WS_URL at build
 * time, or ?ws=… on the page (ws://127.0.0.1:8790/display-ws for TRACE_F#46's
 * arrival-issuer). Without either the page stays a prototype with its test
 * buttons, as before.
 */
function linkUrl(): string | null {
  const fromPage = new URLSearchParams(window.location.search).get("ws");
  const url = fromPage || process.env.NEXT_PUBLIC_DISPLAY_WS_URL || "";
  return /^wss?:\/\//.test(url) ? url : null;
}

/** Keeps the page linked to TRACE_B while it is open; null when no link is configured. */
export function useRendererLink(ready: boolean, replay: (arrival: ArrivalToPlay, signal: AbortSignal) => Promise<ReplayResult>): LinkState | null {
  const [state, setState] = useState<LinkState | null>(null);
  const replayRef = useRef(replay);

  useEffect(() => {
    replayRef.current = replay;
  }, [replay]);

  useEffect(() => {
    // Only once the campus is loaded: an arrival must not wait on the 3D.
    if (!ready) return;
    const url = linkUrl();
    if (!url) return;
    const link = connectRendererLink({
      url,
      versions: { coordinateVersion: COORDINATE_VERSION, campusGraphVersion: CAMPUS_GRAPH_VERSION, threeDMapVersion: THREE_D_MAP_VERSION },
      replay: (arrival, signal) => replayRef.current(arrival, signal),
      onState: setState,
    });
    return () => {
      link.close();
      setState(null);
    };
  }, [ready]);

  return state;
}
