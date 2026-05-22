import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output bundles the app + its dependencies into a minimal
  // .next/standalone directory, suitable for Docker production images.
  output: "standalone",
  // In a monorepo Next.js needs to trace files from the workspace root
  // (two levels up from apps/dashboard) so workspace packages get included.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  transpilePackages: ["@asp/shared"],
};

export default nextConfig;
