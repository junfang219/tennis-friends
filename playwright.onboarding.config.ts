import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["onboarding-review.spec.ts", "team-onboarding-flow.spec.ts"],
  use: { baseURL: "http://127.0.0.1:3105", channel: "chrome" },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome", viewport: { width: 375, height: 812 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: "npm run dev:onboarding",
    url: "http://127.0.0.1:3105/onboarding-preview",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
