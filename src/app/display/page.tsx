import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Noto_Sans_JP } from "next/font/google";

import { DisplayClient } from "@/components/display/display-client";

import "./display.css";

/** RAY, as on the phone screens of /log: Noto Sans JP for Japanese, Geist for Latin, Geist Mono for readouts. */
const rayJp = Noto_Sans_JP({ subsets: ["latin"], weight: ["500", "700", "800"], variable: "--font-ray-jp", display: "swap", preload: false });
const rayLatin = Geist({ subsets: ["latin"], variable: "--font-ray-latin", display: "swap" });
const rayMono = Geist_Mono({ subsets: ["latin"], variable: "--font-ray-mono", display: "swap" });

/** Booth projector screen (issue #24): the arrival QR, then the visitor's walk replayed on the campus. */
export const metadata: Metadata = {
  title: "展示画面 / TRACE",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0c0c0d",
};

export default function DisplayPage() {
  return (
    <div className={`${rayJp.variable} ${rayLatin.variable} ${rayMono.variable}`}>
      <DisplayClient />
    </div>
  );
}
