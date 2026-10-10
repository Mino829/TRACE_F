import type { Metadata, Viewport } from "next";
import { Press_Start_2P, Zen_Kaku_Gothic_New } from "next/font/google";

import { PingLogClient } from "@/components/ping-log/ping-log-client";

import "./log.css";

/** The 54th Shibaura Festival's own type: a pixel face for Latin labels and digits, Zen Kaku Gothic New for Japanese. */
const pixel = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--font-pixel", display: "swap" });
const japanese = Zen_Kaku_Gothic_New({ weight: ["400", "700", "900"], subsets: ["latin"], variable: "--font-jp", display: "swap" });

/** Prototype: a ping every ten minutes, answered with where you are standing. */
export const metadata: Metadata = {
  title: "定期ログ / TRACE",
  robots: { index: false, follow: false },
  // iOS only lets a page notify once it is added to the home screen as an app.
  manifest: "/log.webmanifest",
  appleWebApp: { capable: true, title: "TRACE", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#111018",
  viewportFit: "cover",
};

export default function LogPage() {
  return (
    <div className={`px-root ${pixel.variable} ${japanese.variable}`}>
      <PingLogClient />
    </div>
  );
}
