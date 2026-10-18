import type { Metadata } from "next";

import { DisplayClient } from "@/components/display/display-client";

import "./display.css";

/** Exhibit screen for the booth projector (issue #24): campus overview on the left, first person on the right. */
export const metadata: Metadata = {
  title: "展示画面 / TRACE",
  robots: { index: false, follow: false },
};

export default function DisplayPage() {
  return <DisplayClient />;
}
