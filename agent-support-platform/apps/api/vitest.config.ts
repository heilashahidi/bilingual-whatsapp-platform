import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Workspace packages aren't published, so vitest needs to be told
      // where they live on disk. TypeScript reads this via the pnpm
      // workspace symlink; vitest's vite-node loader does not.
      "@asp/shared": resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Pipeline tests don't need a DB — Prisma is mocked.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
