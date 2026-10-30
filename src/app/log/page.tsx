import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";

import { PingLogClient } from "@/components/ping-log/ping-log-client";

import "./log.css";

/** RAY, on both screens: Noto Sans JP for Japanese, Geist for Latin, Geist Mono for the readouts. */
const rayJp = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-ray-jp", display: "swap", preload: false });
const rayLatin = Geist({ subsets: ["latin"], variable: "--font-ray-latin", display: "swap" });
const rayMono = Geist_Mono({ subsets: ["latin"], variable: "--font-ray-mono", display: "swap" });

/** Prototype: the participant's photo memory, and behind it the developer screen's accuracy test. */
export const metadata: Metadata = {
  title: "ShibaLab 体験型メディアアート作品 / TRACE",
  robots: { index: false, follow: false },
  // iOS only lets a page notify once it is added to the home screen as an app.
  manifest: "/log.webmanifest",
  appleWebApp: { capable: true, title: "TRACE", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#d3d5d3",
  viewportFit: "cover",
};

export default function LogPage() {
  return (
    <div className={`${rayJp.variable} ${rayLatin.variable} ${rayMono.variable}`}>
      <PingLogClient />
    </div>
  );
}
