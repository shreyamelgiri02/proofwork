import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Load the single repository-root .env so web, worker and sandbox share one config.
const monorepoRoot = path.resolve(process.cwd(), "../..");
// forceReload: Next has already loaded (empty) env for apps/web and caches it.
loadEnvConfig(monorepoRoot, process.env.NODE_ENV !== "production", undefined, true);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@proofwork/domain", "@proofwork/database", "@proofwork/adapters"],
  serverExternalPackages: ["postgres"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
