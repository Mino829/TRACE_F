"use client";

import "@/lib/random-uuid";

import dynamic from "next/dynamic";

/**
 * The log screen lives on device APIs (notifications, camera, geolocation,
 * IndexedDB, localStorage) from its first render, so it is client-only.
 */
const PingLogScreen = dynamic(() => import("./ping-log-screen").then((module) => module.PingLogScreen), {
  ssr: false,
  loading: () => <main className="min-h-dvh bg-[#d3d5d3]" aria-busy="true" />,
});

export function PingLogClient() {
  return <PingLogScreen />;
}
