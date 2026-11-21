import { test, expect } from "@playwright/test";
import { reviewGroup, reviewRosterMemberCookie, reviewTeamApi, reviewTeamPath } from "../src/lib/onboarding/review-fixture";

test("roles and member types update before the roster save responds", async ({ page }) => {
  const roleSave = Promise.withResolvers<void>();
  const typeSave = Promise.withResolvers<void>();
  const rosterApi = `**/api/team-roster/${reviewGroup.id}`;
  const memberId = reviewGroup.members[0].id;
  await page.route(rosterApi, async route => {
    const change: unknown = route.request().postDataJSON();
    if (change && typeof change === "object" && "roles" in change) {
      expect(change).toEqual({ action: "member", memberId, roles: ["captain"] });
      await roleSave.promise;
      const cookie = encodeURIComponent(JSON.stringify({ roles: ["captain"] }));
      await route.fulfill({ json: { ok: true }, headers: { "Set-Cookie": `${reviewRosterMemberCookie}=${cookie}; Path=/; HttpOnly; SameSite=Strict` } });
      return;
    }
    expect(change).toEqual({ action: "member", memberId, memberType: "Sub" });
    await typeSave.promise;
    await route.fulfill({ status: 400, json: { error: "Could not save roster change" } });
  });

  await page.goto(`${reviewTeamPath}/settings?tab=roster`);
  const captain = page.getByRole("button", { name: "Captain", exact: true });
  const type = page.getByRole("combobox", { name: "Member type for Captain", exact: true });
  await expect(captain).toHaveAttribute("aria-pressed", "false");
  try {
    await captain.click();
    await expect(captain).toHaveAttribute("aria-pressed", "true");
    await expect(captain).toBeDisabled();
  } finally {
    roleSave.resolve();
  }
  await expect(captain).toBeEnabled();
  await page.reload();
  await expect(captain).toHaveAttribute("aria-pressed", "true");

  try {
    await type.selectOption("Sub");
    await expect(type).toHaveValue("Sub");
    await expect(type).toBeDisabled();
  } finally {
    typeSave.resolve();
  }
  await expect(page.getByRole("region", { name: "Team members" }).getByRole("alert")).toHaveText("Could not save roster change");
  await expect(type).toHaveValue("");
  await expect(captain).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Back to team returns to the sample team from its roster", async ({ page }) => {
  await page.goto(reviewTeamPath);
  const team = page.getByRole("heading", { name: "Shared review", exact: true });
  await expect(team).toBeVisible();
  await page.getByRole("link", { name: "View roster", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Roster", exact: true })).toBeVisible();
  await expect(page.getByText("USTA registration · Not enabled", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to team", exact: true }).click();
  await expect(team).toBeVisible();
  await page.getByRole("link", { name: "Team settings", exact: true }).click();
  await expect(page.getByRole("tablist", { name: "Team settings" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await page.request.patch(reviewTeamApi, { data: { action: "registration" } })).status()).toBe(404);
});

test("invite to the app, add USTA later, then remind only unconfirmed players", async ({ page, request }) => {
  const mutations: string[] = [];
  page.on("request", req => { if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method())) mutations.push(req.url()); });
  await page.goto("/onboarding-preview");
  await page.getByLabel("Team name", { exact: true }).fill("Weekend Crew");
  await page.getByLabel("Team description (optional)", { exact: true }).fill("Saturday tennis");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [name, email] of [["Sam Lee", "sam@example.com"], ["Taylor Chen", "taylor@example.com"]]) {
    await page.getByLabel("Player name", { exact: true }).fill(name);
    await expect(page.getByRole("textbox", { name: "Phone number", exact: true })).toHaveCount(0);
    await page.getByLabel("Email", { exact: true }).fill(email);
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
