import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  // A trial build can go elsewhere (NEXT_DIST_DIR=.next-check) without touching the build the platform runs from.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Do not advertise the framework in every response.
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.NODE_ENV === "production") }];
  },
};

export default nextConfig;
