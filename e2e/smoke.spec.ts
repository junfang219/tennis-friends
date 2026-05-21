import { expect, test } from "@playwright/test";

// Smoke test — confirms the dev server boots and serves something at /.
// Real RLS-isolation e2e suites land in Phase 2 (see docs/supabase-migration-plan.md).
test("home page responds", async ({ page }) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  expect(response!.status()).toBeLessThan(500);
});
