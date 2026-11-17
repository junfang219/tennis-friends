import { expect, test, type BrowserContext } from "@playwright/test";
import { groupId, playerId, userId, token, managementFixture, player } from "./helpers/team-management";
async function requestToJoin(context: BrowserContext) {
  const page = await context.newPage(); await page.goto("/onboarding-preview?flow=shared");
  await page.getByRole("button", { name: "Request to join", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Request sent. Waiting for captain approval.");
  await expect(page.getByRole("link", { name: "Open team", exact: true })).toHaveCount(0);
  return page;
}
test("share once, receive the request on Roster, approve, and open the team", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  await page.goto(`/groups/${groupId}/invite-players`);
  await page.getByRole("button", { name: "Share a team link instead", exact: true }).click();
  await page.getByRole("button", { name: "Create shared team link", exact: true }).click();
  await expect(page.getByLabel("Team invitation link", { exact: true })).toHaveValue(new RegExp(`/join-team/${token}$`));
  const applicant = await requestToJoin(context); expect(fixture.state.players).toHaveLength(0);
  await page.getByRole("link", { name: "Back to roster", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve New Player", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve New Player", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve New Player", exact: true })).toHaveCount(0);
  expect(fixture.state.players[0].accepted_by).toBe(userId);
  await applicant.getByRole("button", { name: "Check approval status", exact: true }).click();
  await expect(applicant.getByRole("link", { name: "Open team", exact: true })).toHaveAttribute("href", `/groups/${groupId}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/tennis-roster-${test.info().project.name}.png`, fullPage: true });
});
for (const choice of ["existing", "new"] as const) test(`approval supports ${choice} roster entries`, async ({ context, page }) => {
  const fixture = await managementFixture(context, [player(playerId, { confirmed_at: "2026-11-17T00:00:00Z" })]);
  fixture.shared.token = token; fixture.shared.enabled = true;
  await requestToJoin(context); await page.goto(`/groups/${groupId}/roster`);
  const select = page.getByRole("combobox", { name: "Roster entry for New Player", exact: true });
  await select.selectOption(playerId); if (choice === "new") await select.selectOption("");
  await page.getByRole("button", { name: "Approve New Player", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve New Player", exact: true })).toHaveCount(0);
  expect(fixture.writes.find(w => w.path.endsWith("/join-requests"))?.body).toMatchObject({ playerId: choice === "existing" ? playerId : null });
  if (choice === "existing") expect(fixture.state.players[0]).toMatchObject({ accepted_by: userId, confirmed_at: "2026-11-17T00:00:00Z" });
});
test("rejection and failed approval grant no membership", async ({ context, page }) => {
  const fixture = await managementFixture(context); fixture.shared.token = token; fixture.shared.enabled = true;
  const applicant = await requestToJoin(context); await page.goto(`/groups/${groupId}/roster`);
  fixture.controls.denyApproval = true;
  await page.getByRole("button", { name: "Approve New Player", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Approval denied");
  expect(fixture.state.players).toHaveLength(0); fixture.controls.denyApproval = false;
  await page.getByRole("button", { name: "Reject New Player", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reject New Player", exact: true })).toHaveCount(0);
  await applicant.getByRole("button", { name: "Check approval status", exact: true }).click();
  await expect(applicant.getByRole("status")).toContainText("not approved"); expect(fixture.state.players).toHaveLength(0);
});
test("replacement and disable still invalidate shared URLs", async ({ context, page }) => {
  await managementFixture(context); await page.goto(`/groups/${groupId}/invite-players`);
  await page.getByRole("button", { name: "Share a team link instead", exact: true }).click();
  await page.getByRole("button", { name: "Create shared team link", exact: true }).click();
  await page.getByText("Manage team link", { exact: true }).click();
  await page.getByRole("button", { name: "Replace team link", exact: true }).click();
  await expect(page.getByLabel("Team invitation link", { exact: true })).toHaveValue(new RegExp(`/join-team/${"b".repeat(64)}$`));
  expect(await page.evaluate(async t => (await fetch(`/api/team-join/${t}`)).status, token)).toBe(404);
  await page.getByRole("button", { name: "Disable team link", exact: true }).click();
  await expect(page.getByLabel("Team invitation link", { exact: true })).toHaveCount(0);
});
test("signed-out players return to the shared link after signing in", async ({ page }) => {
  await page.goto("/onboarding-preview?flow=shared&account=signed-out");
  await expect(page.getByRole("link", { name: "Sign in to request to join", exact: true })).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/join-team/${token}`)}`);
});

test("captains already on Roster can refresh newly arrived join requests", async ({ context, page }) => {
  const fixture = await managementFixture(context); fixture.shared.token = token; fixture.shared.enabled = true;
  await page.goto(`/groups/${groupId}/roster`);
  await expect(page.getByText("No pending requests.", { exact: false })).toBeVisible();
  await requestToJoin(context);
  await page.getByRole("button", { name: "Refresh requests", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve New Player", exact: true })).toBeVisible();
});
