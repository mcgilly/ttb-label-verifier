import { defineConfig } from "vitest/config";

/**
 * Separate config for the accuracy eval (`npm run eval`). Kept out of the normal
 * `npm test` run because it calls the real Claude API — it costs tokens, is
 * non-deterministic, and needs a key. Unit tests stay fast and offline.
 */
export default defineConfig({
  test: {
    include: ["eval/**/*.eval.ts"],
    setupFiles: ["eval/setup-env.ts"],
    testTimeout: 60_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
