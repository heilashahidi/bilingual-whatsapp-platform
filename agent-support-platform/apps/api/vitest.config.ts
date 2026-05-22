import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Pipeline tests don't need a DB — Prisma is mocked.
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
  },
});
