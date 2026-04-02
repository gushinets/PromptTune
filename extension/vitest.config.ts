import { defineConfig } from "vitest/config";
import path from "node:path";

const coverageInclude = [
  "adapters/**/*.{ts,tsx}",
  "entrypoints/**/*.{ts,tsx}",
  "shared/**/*.{ts,tsx}",
];

const coverageExclude = [
  "__tests__/**",
  "**/*.d.ts",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.test.ts",
  "**/*.test.tsx",
  "adapters/types.ts",
  "entrypoints/popup/main.tsx",
  "shared/messages.ts",
  "shared/types.ts",
  "wxt.config.ts",
];

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@adapters": path.resolve(__dirname, "adapters"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      all: true,
      include: coverageInclude,
      exclude: coverageExclude,
      reporter: ["text", "html", "lcov", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
