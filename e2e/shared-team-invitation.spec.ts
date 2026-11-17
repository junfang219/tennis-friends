import { expect, test, type BrowserContext } from "@playwright/test";
import { z } from "zod";
import { saveOnboardingSchema, storedOnboardingSchema } from "../src/lib/onboarding/contracts";
import { reviewJoinRequestSchema, teamLinkActionSchema, teamLinkStateSchema } from "../src/lib/onboarding/shared";

const groupId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const userId = "55555555-5555-4555-8555-555555555555";
const playerId = "66666666-6666-4666-8666-666666666666";
const token = "a".repeat(64);
async function fixture(context: BrowserContext) {
  const team: z.infer<typeof storedOnboardingSchema> = {
    config: { name: "Shared review", description: "An isolated team invitation", includeUsta: false, teamNumber: "", deadline: "" }, players: [],
  };
  const shared: z.infer<typeof teamLinkStateSchema> = { token: null, enabled: false, requests: [] };
  let status = "ready";
  const writes: Array<{ path: string; body: unknown }> = [];
  const controls = { denyApproval: false };
  await context.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const post = request.method() === "POST";
    if (post || request.method() === "PUT") writes.push({ path, body: request.postDataJSON() ?? null });
    if (path.includes("/team-join/")) {
      if (!shared.enabled || !path.endsWith(shared.token ?? "missing")) return route.fulfill({ status: 404, json: { error: "Unavailable" } });
      if (post && status === "ready") {
        status = "pending";
        shared.requests.push({ id: requestId, userId, name: "New Player", email: "new@example.com", createdAt: "2026-11-17T00:00:00Z" });
      }
      return route.fulfill({ json: { groupId, ...team.config, status } });
    }
    if (path.endsWith("/shared-link")) {
      if (post) {
        const { action } = teamLinkActionSchema.parse(request.postDataJSON());
        if (action === "enable") { shared.token ??= token; shared.enabled = true; }
        if (action === "replace") { shared.token = "b".repeat(64); shared.enabled = true; }
        if (action === "disable") shared.enabled = false;
      }
      return route.fulfill({ json: shared });
    }
    if (path.endsWith("/join-requests")) {
      if (controls.denyApproval) return route.fulfill({ status: 403, json: { error: "Approval denied" } });
      const input = reviewJoinRequestSchema.parse(request.postDataJSON());
      expect(input.requestId).toBe(requestId);
      shared.requests = [];
      status = input.decision === "approve" ? "joined" : "rejected";
      if (input.decision === "approve" && input.playerId) team.players = team.players.map(p => p.id === input.playerId ? { ...p, accepted_by: userId, associated_account_id: userId, accepted_at: "2026-11-17T00:00:00Z" } : p);
      if (input.decision === "approve" && !input.playerId) team.players.push({
        id: playerId, group_id: groupId, member_id: playerId, name: "New Player", phone: null, email: null,
        associated_account_id: userId, associated_account_name: "New Player", accepted_by: userId,
        confirmed_at: null, sent_at: null, accepted_at: "2026-11-17T00:00:00Z", token: "c".repeat(64), expires_at: "2099-12-31T00:00:00Z", revoked_at: null,
      });
      return route.fulfill({ json: { status: input.decision === "approve" ? "approved" : "rejected" } });
    }
    if (path.endsWith("/friends")) return route.fulfill({ json: [] });
    if (path.endsWith("/send")) {
      expect(request.postDataJSON()).toMatchObject({ mode: "email", reminder: false });
      expect(team.players[0]?.email).toBe("email@example.com");
      return route.fulfill({ json: { sent: 1, failed: 0, pending: 0, message: "Test provider accepted email" } });
    }
    if (path === `/api/team-onboarding/${groupId}`) {
      if (request.method() === "PUT") {
        const input = saveOnboardingSchema.parse(request.postDataJSON());
        team.config = input.draft;
        team.players = input.players.map(p => ({
          id: p.id, group_id: groupId, member_id: null, name: p.name, phone: p.phone || null, email: p.email || null,
          associated_account_id: null, associated_account_name: null, accepted_by: null, confirmed_at: p.confirmedAt,
          sent_at: null, accepted_at: null, token: "c".repeat(64), expires_at: "2099-12-31T00:00:00Z", revoked_at: null,
        }));
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: team });
    }
    return route.fulfill({ status: 404, json: { error: "No live APIs in this test" } });
  });
  const captain = await context.newPage();
  await captain.goto("/onboarding-preview?flow=team");
  await expect(captain.getByRole("heading", { name: "Shared review", exact: true })).toBeVisible();
  await expect(captain.getByRole("button", { name: "Create shared team link", exact: true })).toBeVisible();
  return { captain, team, shared, writes, controls };
}

async function requestToJoin(context: BrowserContext) {
  const player = await context.newPage();
  await player.goto("/onboarding-preview?flow=shared");
  await player.getByRole("button", { name: "Request to join", exact: true }).click();
  await expect(player.getByRole("status")).toHaveText("Request sent. Waiting for captain approval.");
  await expect(player.getByRole("link", { name: "Open team", exact: true })).toHaveCount(0);
  return player;
}

test("one shared link requests approval before joining and reopens after approval", async ({ context }) => {
  const { captain, team, shared, writes } = await fixture(context);
  await captain.getByRole("button", { name: "Create shared team link", exact: true }).click();
  await expect(captain.getByLabel("Team invitation link", { exact: true })).toHaveValue(new RegExp(`/join-team/${token}$`));
  const player = await requestToJoin(context);
  expect(team.players).toHaveLength(0);
  await captain.getByRole("button", { name: "Refresh requests", exact: true }).click();
  await expect(captain.getByRole("button", { name: "Approve New Player", exact: true })).toBeVisible();
  await captain.screenshot({ path: `/tmp/tennis-shared-${test.info().project.name}.png`, fullPage: true });
  await captain.getByRole("button", { name: "Approve New Player", exact: true }).click();
  await expect(captain.getByText("TennisFriends: 1 / 1 joined", { exact: true })).toBeVisible();
  expect(shared.requests).toHaveLength(0);
  await player.getByRole("button", { name: "Check approval status", exact: true }).click();
  await expect(player.getByRole("link", { name: "Open team", exact: true })).toHaveAttribute("href", `/groups/${groupId}`);
  expect(writes.filter(w => w.path.endsWith("/join-requests")).map(w => w.body)).toEqual([{ requestId, decision: "approve", playerId: null }]);
  for (const page of [captain, player]) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const choice of ["existing", "new"] as const) {
  test(`captain can approve a request as an ${choice} roster entry`, async ({ context }) => {
    const { captain, team, writes } = await fixture(context);
    team.players.push({
      id: playerId, group_id: groupId, member_id: playerId, name: "Prepared Player", phone: null, email: null,
      associated_account_id: null, associated_account_name: null, accepted_by: null, accepted_at: null,
      confirmed_at: "2026-11-17T00:00:00Z", sent_at: null, revoked_at: null,
      token: "c".repeat(64), expires_at: "2099-12-31T00:00:00Z",
    });
    await captain.reload();
    await captain.getByRole("button", { name: "Create shared team link", exact: true }).click();
    await requestToJoin(context);
    await captain.getByRole("button", { name: "Refresh requests", exact: true }).click();
    const select = captain.getByRole("combobox", { name: "Roster entry for New Player", exact: true });
    await select.selectOption(playerId);
    if (choice === "new") await select.selectOption("");
    await captain.getByRole("button", { name: "Approve New Player", exact: true }).click();
    await expect(captain.getByRole("button", { name: "Approve New Player", exact: true })).toHaveCount(0);
    expect(writes.find(w => w.path.endsWith("/join-requests"))?.body).toMatchObject({ playerId: choice === "existing" ? playerId : null });
    if (choice === "existing") {
      expect(team.players).toHaveLength(1);
      expect(team.players[0]).toMatchObject({ accepted_by: userId, confirmed_at: "2026-11-17T00:00:00Z" });
    }
  });
}

test("rejecting a request leaves the applicant outside the team", async ({ context }) => {
  const { captain, team } = await fixture(context);
  await captain.getByRole("button", { name: "Create shared team link", exact: true }).click();
  const player = await requestToJoin(context);
  await captain.getByRole("button", { name: "Refresh requests", exact: true }).click();
  await captain.getByRole("button", { name: "Reject New Player", exact: true }).click();
  await expect(captain.getByRole("status")).toHaveText("Request from New Player rejected.");
  await player.getByRole("button", { name: "Check approval status", exact: true }).click();
  await expect(player.getByRole("status")).toContainText("Your request was not approved.");
  await expect(player.getByRole("link", { name: "Open team", exact: true })).toHaveCount(0);
  expect(team.players).toHaveLength(0);
});

test("replacing and disabling the shared link invalidates old URLs", async ({ context }) => {
  const { captain } = await fixture(context);
  await captain.getByRole("button", { name: "Create shared team link", exact: true }).click();
  const section = captain.getByRole("group", { name: "Shared team invitation", exact: true });
  await section.getByText("Manage team link", { exact: true }).click();
  await section.getByRole("button", { name: "Replace team link", exact: true }).click();
  await expect(captain.getByLabel("Team invitation link", { exact: true })).toHaveValue(new RegExp(`/join-team/${"b".repeat(64)}$`));
  expect(await captain.evaluate(async value => (await fetch(`/api/team-join/${value}`)).status, token)).toBe(404);
  await section.getByRole("button", { name: "Disable team link", exact: true }).click();
  await expect(captain.getByLabel("Team invitation link", { exact: true })).toHaveCount(0);
  expect(await captain.evaluate(async value => (await fetch(`/api/team-join/${value}`, { method: "POST" })).status, "b".repeat(64))).toBe(404);
});

test("failed approval keeps the request pending and surfaces the error", async ({ context }) => {
  const { captain, team, controls } = await fixture(context);
  await captain.getByRole("button", { name: "Create shared team link", exact: true }).click();
  await requestToJoin(context);
  await captain.getByRole("button", { name: "Refresh requests", exact: true }).click();
  controls.denyApproval = true;
  await captain.getByRole("button", { name: "Approve New Player", exact: true }).click();
  await expect(captain.getByRole("main").getByRole("alert")).toHaveText("Approval denied");
  await expect(captain.getByRole("button", { name: "Approve New Player", exact: true })).toBeEnabled();
  expect(team.players).toHaveLength(0);
});

test("Players can be skipped and phone entry is absent; personal email invitations still work", async ({ context }) => {
  const { captain, writes } = await fixture(context);
  for (let i = 0; i < 2; i++) await captain.getByRole("button", { name: "Back", exact: true }).click();
  await expect(captain.getByRole("heading", { name: "Add your players", exact: true })).toBeVisible();
  await expect(captain.getByRole("textbox", { name: "Phone number", exact: true })).toHaveCount(0);
  await captain.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(captain.getByRole("heading", { name: "Invite your players", exact: true })).toBeVisible();
  await captain.getByRole("button", { name: "Back", exact: true }).click();
  await captain.getByLabel("Player name", { exact: true }).fill("Email Player");
  await captain.getByLabel("Email", { exact: true }).fill("email@example.com");
  await captain.getByRole("button", { name: "Add player", exact: true }).click();
  for (let i = 0; i < 2; i++) await captain.getByRole("button", { name: "Continue", exact: true }).click();
  expect(writes.filter(w => w.path.endsWith("/send"))).toHaveLength(0);
  await captain.getByRole("button", { name: "Send email invitations", exact: true }).click();
  await expect(captain.getByRole("status")).toContainText("1 emails accepted");
  expect(writes.filter(w => w.path.endsWith("/send"))).toHaveLength(1);
  await expect(captain.getByRole("button", { name: "Share invitation links", exact: true })).toHaveCount(0);
});

test("signed-out players get a sign-in link that returns to their shared invitation", async ({ page }) => {
  await page.goto("/onboarding-preview?flow=shared&account=signed-out");
  await expect(page.getByRole("link", { name: "Sign in to request to join", exact: true })).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/join-team/${token}`)}`);
  await expect(page.getByRole("button", { name: "Request to join", exact: true })).toHaveCount(0);
});
