import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit tests only (A96): pure logic, no database and no server, so `npm test` stays fast enough
 * to run on every change. Anything that needs a running app lives in tests/e2e instead.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    reporters: "dot",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
