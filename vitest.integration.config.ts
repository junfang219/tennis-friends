import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

// Integration tests hit the live Supabase project. They require:
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
//   SUPABASE_SECRET_KEY
// These come from .env (gitignored). Tests that need them skip cleanly
// when secrets aren't available so CI can opt in explicitly.
loadDotenv({ path: path.resolve(__dirname, ".env") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**", ".next/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Integration tests create real auth users; serialize so fixtures don't collide.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
