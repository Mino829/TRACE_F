import type { NextConfig } from "next";

/**
 * `NEXT_STATIC_EXPORT=1 next build` writes the app as static files to out/,
 * which is how it is served from Cloudflare Pages. A plain `next dev` or
 * `next build` is unaffected.
 */
const nextConfig: NextConfig = {
  ...(process.env.NEXT_STATIC_EXPORT === "1" ? { output: "export" as const } : {}),
};

export default nextConfig;
