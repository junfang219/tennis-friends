import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "tests/integration/**", "node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["e2e/**", "tests/**", "**/*.config.ts", ".next/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Next.js' `server-only` guard throws at import time outside an RSC
      // build. In a Node test runner that means any server-tagged module
      // (admin clients, account cleanup, push fan-out) crashes its test
      // suite before any tests run. Aliasing to an empty module keeps the
      // guard meaningful in app code while letting tests exercise the logic.
      "server-only": path.resolve(__dirname, "./src/test/server-only-shim.ts"),
    },
  },
});
