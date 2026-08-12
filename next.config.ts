import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

const packageMetadata = JSON.parse(readFileSync("package.json", "utf8")) as {
  version?: unknown;
};
if (
  typeof packageMetadata.version !== "string" ||
  !/^[0-9A-Za-z.-]+$/.test(packageMetadata.version)
) {
  throw new Error("package.json must contain a cache-safe release version");
}
const packageVersion = packageMetadata.version;

const nextConfig: NextConfig = {
  output: "export",
  poweredByHeader: false,
  reactStrictMode: true,
  trailingSlash: true,
  generateBuildId: async () => `agent-state-dashboard-${packageVersion}`,
};

export default nextConfig;
