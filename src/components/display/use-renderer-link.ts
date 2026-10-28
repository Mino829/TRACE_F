"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { COORDINATE_VERSION, CAMPUS_GRAPH_VERSION, THREE_D_MAP_VERSION } from "@/lib/display/campus-graph";
import { connectRendererLink, type ArrivalToPlay, type LinkState, type RendererLink, type ReplayResult } from "@/lib/display/renderer-link";

import "./renderer-link.css";

/**
 * The booth's link to TRACE_B, when the build has both
 * NEXT_PUBLIC_DISPLAY_API_URL (TRACE_B's origin) and NEXT_PUBLIC_GOOGLE_CLIENT_ID
 * (the Google sign-in for operators). Without them the page stays a prototype
 * with its test buttons, as before.
 */
const API_URL = process.env.NEXT_PUBLIC_DISPLAY_API_URL ?? "";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

export type DisplayLink = {
  state: LinkState;
  /** Why the link stopped, when it did. */
  detail: string | null;
  googleClientId: string;
  /** The operator signed in with Google: the ID token stays in this tab's memory only. */
  signIn: (idToken: string) => void;
};

/** Keeps the page linked to TRACE_B while it is open; null when no link is configured. */
export function useRendererLink(
  ready: boolean,
  replay: (arrival: ArrivalToPlay, signal: AbortSignal) => Promise<ReplayResult>,
  onIdle: () => void,
): DisplayLink | null {
  const configured = /^https?:\/\//.test(API_URL) && GOOGLE_CLIENT_ID.length > 0;
  const [state, setState] = useState<{ state: LinkState; detail: string | null }>({ state: "login", detail: null });
  const replayRef = useRef(replay);
  const onIdleRef = useRef(onIdle);
  const idTokenRef = useRef<string | null>(null);
  const linkRef = useRef<RendererLink | null>(null);

  useEffect(() => {
    replayRef.current = replay;
    onIdleRef.current = onIdle;
  }, [replay, onIdle]);

  useEffect(() => {
    // Only once the campus is loaded: an arrival must not wait on the 3D.
    if (!ready || !configured) return;
    const link = connectRendererLink({
      apiUrl: API_URL,
      versions: { coordinateVersion: COORDINATE_VERSION, campusGraphVersion: CAMPUS_GRAPH_VERSION, threeDMapVersion: THREE_D_MAP_VERSION },
      idToken: () => idTokenRef.current,
      replay: (arrival, signal) => replayRef.current(arrival, signal),
      onIdle: () => onIdleRef.current(),
      onState: (next, detail) => setState({ state: next, detail: detail ?? null }),
    });
    linkRef.current = link;
    return () => {
      link.close();
      linkRef.current = null;
    };
  }, [ready, configured]);

  const signIn = useCallback((idToken: string) => {
    idTokenRef.current = idToken;
    linkRef.current?.signedIn();
  }, []);

  return configured ? { ...state, googleClientId: GOOGLE_CLIENT_ID, signIn } : null;
}
