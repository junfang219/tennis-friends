import { test, expect } from "@playwright/test";
import { reviewGroup, reviewRosterMemberCookie, reviewTeamApi, reviewTeamPath } from "../src/lib/onboarding/review-fixture";

test("roster dropdown replaces the previous option and restores it if saving fails", async ({ page, baseURL }) => {
  const roleSave = Promise.withResolvers<void>();
  const rejectedGuestSave = Promise.withResolvers<void>();
  const rosterApi = `**/api/team-roster/${reviewGroup.id}`;
  const memberId = reviewGroup.members[0].id;
  const cookieValue = (member: { roles: string[]; memberType: string }) => encodeURIComponent(JSON.stringify(member));
  await page.context().addCookies([{
    name: reviewRosterMemberCookie,
    value: cookieValue({ roles: ["captain", "manager"], memberType: "Guest" }),
    url: new URL(reviewTeamPath, baseURL).origin,
  }]);
  const edits = [
    { roles: ["captain"], memberType: "" },
    { roles: ["manager"], memberType: "" },
    { roles: [], memberType: "Guest" },
    { roles: [], memberType: "Guest" },
    { roles: [], memberType: "" },
  ];
  let nextEdit = 0;
  await page.route(rosterApi, async route => {
    const index = nextEdit++;
    const edit = edits[index];
    expect(route.request().postDataJSON()).toEqual({ action: "member", memberId, ...edit });
    if (index === 0) await roleSave.promise;
    if (index === 2) {
      await rejectedGuestSave.promise;
      await route.fulfill({ status: 400, json: { error: "Could not save roster change" } });
      return;
    }
    await route.fulfill({
      json: { ok: true },
      headers: { "Set-Cookie": `${reviewRosterMemberCookie}=${cookieValue(edit)}; Path=/; HttpOnly; SameSite=Strict` },
    });
  });

  await page.goto(`${reviewTeamPath}/settings?tab=roster`);
  const dropdown = page.getByLabel(/^Roles for Captain:/);
  const options = page.getByRole("group", { name: "Roster options for Captain", exact: true });
  const selected = options.getByRole("button", { pressed: true });
  const captain = options.getByRole("button", { name: "Captain", exact: true });
  const coCaptain = options.getByRole("button", { name: "Co-captain", exact: true });
  const member = options.getByRole("button", { name: "Member", exact: true });
  const guest = options.getByRole("button", { name: "Guest", exact: true });
  await expect(dropdown).toHaveAccessibleName("Roles for Captain: Co-captain");
  await expect(options).toBeHidden();
  await dropdown.click();
  await expect(options.getByRole("button")).toHaveText(["Captain", "Co-captain", "Member", "Guest"]);
  await expect(selected).toHaveText(["Co-captain"]);
  await coCaptain.click();
  await expect(options).toBeHidden();
  await expect(dropdown).toBeFocused();
  await dropdown.click();
  await expect(coCaptain).toBeEnabled();
  expect(nextEdit).toBe(0);

  try {
    await captain.click();
    await expect(options).toBeHidden();
    await expect(dropdown).toBeFocused();
    await expect(dropdown).toHaveAccessibleName("Roles for Captain: Captain");
    await dropdown.click();
    await expect(selected).toHaveText(["Captain"]);
    await expect(captain).toBeDisabled();
  } finally {
    roleSave.resolve();
  }
  await expect(captain).toBeEnabled();
  await coCaptain.click();
  await expect(options).toBeHidden();
  await dropdown.click();
  await expect(coCaptain).toBeEnabled();
  await page.reload();
  await expect(dropdown).toHaveAccessibleName("Roles for Captain: Co-captain");
  await dropdown.click();
  await expect(selected).toHaveText(["Co-captain"]);

  try {
    await guest.click();
    await expect(options).toBeHidden();
    await expect(dropdown).toHaveAccessibleName("Roles for Captain: Guest");
    await dropdown.click();
    await expect(selected).toHaveText(["Guest"]);
    await expect(guest).toBeDisabled();
  } finally {
    rejectedGuestSave.resolve();
  }
  await expect(page.getByRole("region", { name: "Team members" }).getByRole("alert")).toHaveText("Could not save roster change");
  await expect(selected).toHaveText(["Co-captain"]);
  await guest.click();
  await expect(options).toBeHidden();
  await dropdown.click();
  await expect(guest).toBeEnabled();
  await page.reload();
  await expect(dropdown).toHaveAccessibleName("Roles for Captain: Guest");
  await dropdown.click();
  await expect(selected).toHaveText(["Guest"]);
  await member.click();
  await expect(member).toBeHidden();
  await dropdown.click();
  await expect(member).toBeEnabled();
  await page.reload();
  await expect(dropdown).toHaveAccessibleName("Roles for Captain: Member");
  await dropdown.click();
  await expect(selected).toHaveText(["Member"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await member.press("Escape");
  await expect(member).toBeHidden();
  await expect(dropdown).toBeFocused();
  expect(nextEdit).toBe(edits.length);
});

test("Back to team returns to the sample team from its roster", async ({ page }) => {
  await page.goto(reviewTeamPath);
  const team = page.getByRole("heading", { name: "Shared review", exact: true });
  await expect(team).toBeVisible();
  await page.getByRole("link", { name: "View roster", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Roster", exact: true })).toBeVisible();
  await expect(page.getByText("USTA registration · Not enabled", { exact: true })).toBeVisible();
  const teamActions = page.locator("main > details:last-child");
  await teamActions.getByText("Team actions", { exact: true }).click();
  await expect(teamActions.getByRole("button", { name: "Delete team", exact: true })).toBeInViewport();
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
