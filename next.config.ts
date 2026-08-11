import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  reactStrictMode: true,
  trailingSlash: true,
  generateBuildId: async () => "agent-state-dashboard-static",
};

export default nextConfig;
