"use client";

import "@/lib/random-uuid";
import "@/lib/translate-guard";

import dynamic from "next/dynamic";

/** Notifications, camera, IndexedDB and localStorage require a client-only screen. */
const PingLogScreen = dynamic(() => import("./ping-log-screen").then((module) => module.PingLogScreen), {
  ssr: false,
  loading: () => <main className="min-h-dvh bg-[#d3d5d3]" aria-busy="true" />,
});

export function PingLogClient() {
  return <PingLogScreen />;
}
