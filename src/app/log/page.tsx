import type { Metadata, Viewport } from "next";
import { DotGothic16, Press_Start_2P } from "next/font/google";

import { PingLogClient } from "@/components/ping-log/ping-log-client";

import "./log.css";

/** Pixel type throughout: DotGothic16 for Japanese, Press Start 2P for Latin labels and digits. */
const pixel = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-pixel", display: "swap" });
const dot = DotGothic16({ weight: "400", subsets: ["latin"], variable: "--font-dot", display: "swap" });

/** Prototype: a ping every ten minutes, answered with where you are standing. */
export const metadata: Metadata = {
  title: "定期ログ / TRACE",
  robots: { index: false, follow: false },
  // iOS only lets a page notify once it is added to the home screen as an app.
  manifest: "/log.webmanifest",
  appleWebApp: { capable: true, title: "TRACE", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#1b2150",
  viewportFit: "cover",
};

export default function LogPage() {
  return (
    <div className={`px-root ${pixel.variable} ${dot.variable}`}>
      <PingLogClient />
    </div>
  );
}
