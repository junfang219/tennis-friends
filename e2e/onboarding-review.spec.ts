import { test, expect } from "@playwright/test";

test("invite to the app, add USTA later, then remind only unconfirmed players", async ({ page, request }) => {
  const mutations: string[] = [];
  page.on("request", req => { if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method())) mutations.push(req.url()); });
  await page.goto("/onboarding-preview");
  await page.getByLabel("Team name", { exact: true }).fill("Weekend Crew");
  await page.getByLabel("Team description (optional)", { exact: true }).fill("Saturday tennis");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [name, phone] of [["Sam Lee", "2065550101"], ["Taylor Chen", "2065550102"]]) {
    await page.getByLabel("Player name", { exact: true }).fill(name);
    await page.getByLabel("Phone number", { exact: true }).fill(phone);
    await page.getByRole("button", { name: "Add player", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "TennisFriends members", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Include USTA registration instructions", { exact: true })).not.toBeChecked();
  await page.getByRole("textbox", { name: /^Invitation message/ }).fill("Come join our team!");
  await expect(page.locator("pre")).toContainText("Join the team:");
  await expect(page.locator("pre")).not.toContainText("USTA");
  await page.getByRole("button", { name: "Simulate sending invitations", exact: true }).click();
  await expect(page.getByText("USTA registration tracking is not enabled.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add USTA registration task", exact: true }).click();
  await page.getByRole("button", { name: "Simulate sending invitations", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("10-digit");
  await page.getByLabel("USTA team name", { exact: true }).fill("Official Crew");
  await page.getByLabel("USTA team number (required for USTA invitations)", { exact: true }).fill("1234567890");
  await page.getByLabel("Registration deadline (required for USTA invitations)", { exact: true }).fill("2026-12-04");
  await page.getByRole("button", { name: "Simulate sending invitations", exact: true }).click();
  await page.getByRole("button", { name: "Confirm registration for Sam Lee", exact: true }).click();
  await page.getByRole("button", { name: "Review USTA reminders (1)", exact: true }).click();
  await expect(page.getByText("Recipients:")).toContainText("Taylor Chen");
  await expect(page.getByText("Recipients:")).not.toContainText("Sam Lee");
  await page.getByRole("button", { name: "Simulate reminders", exact: true }).click();
  await page.reload();
  await expect(page.getByText("USTA registration: 1 / 2 confirmed", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(mutations).toEqual([]);
  expect((await request.get("/api/groups/test")).status()).toBe(404);
});
