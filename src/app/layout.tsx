import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRACE",
  description: "芝浦祭で撮った写真で、学祭の一日を残す Web アプリです。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
