import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Pin tracing to this repo so the standalone bundle is correct even when a parent
  // directory also has a lockfile (the PWR LABS checkout shares one workspace root).
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
