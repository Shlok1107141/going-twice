import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Lower peak memory for `next build --webpack` (Render's build container is memory-limited).
  experimental: { webpackMemoryOptimizations: true },
  // Cross-origin isolation for the stage and Gus's voice worker: it lets the in-browser Kokoro model use
  // several threads (about 3x faster). "credentialless" keeps cross-origin images and CDN scripts working.
  async headers() {
    const isolate = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ];
    return [
      { source: "/stage", headers: isolate },
      { source: "/demo", headers: isolate },
      { source: "/gus/:path*", headers: isolate },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
