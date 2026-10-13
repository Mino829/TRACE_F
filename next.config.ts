import type { NextConfig } from "next";

/** Static assets in Cloudflare use the site Worker for /api/backend/*.
 * Local Next development sends the same paths to the local Go API.
 */
const nextConfig: NextConfig = {
  ...(process.env.NEXT_STATIC_EXPORT === "1"
    ? { output: "export" as const }
    : { async rewrites() {
      const backend = new URL(process.env.TRACE_BACKEND_URL ?? "http://127.0.0.1:8080");
      if (backend.protocol !== "http:" && backend.protocol !== "https:") throw new Error("Invalid TRACE_BACKEND_URL");
      return [{ source: "/api/backend/:path*", destination: `${backend.origin}/:path*` }];
    } }),
};

export default nextConfig;
