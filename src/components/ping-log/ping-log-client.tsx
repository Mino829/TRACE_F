"use client";

import dynamic from "next/dynamic";

/**
 * The log screen lives on device APIs (notifications, camera, geolocation,
 * IndexedDB, localStorage) from its first render, so it is client-only.
 */
const PingLogScreen = dynamic(() => import("./ping-log-screen").then((module) => module.PingLogScreen), {
  ssr: false,
  loading: () => (
    <main className="grid min-h-dvh place-items-center">
      <p className="px-pixel text-[11px] text-(--px-text)">
        LOADING<span className="px-blink">_</span>
      </p>
    </main>
  ),
});

export function PingLogClient() {
  return <PingLogScreen />;
}
