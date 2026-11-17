import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { saveOnboardingSchema, storedOnboardingSchema, storedPlayerSchema } from "../src/lib/onboarding/contracts";

type Player = z.infer<typeof storedPlayerSchema>;
const groupId = "33333333-3333-4333-8333-333333333333";
const wrongAccount = "66666666-6666-4666-8666-666666666666";
const correctAccount = "77777777-7777-4777-8777-777777777777";
const friends = [{ id: wrongAccount, name: "Wrong Account" }, { id: correctAccount, name: "Correct Account" }];

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id, group_id: groupId, member_id: null, name: "Invited Player",
    phone: null, email: "player@example.com", associated_account_id: null,
    associated_account_name: null, accepted_by: null, confirmed_at: null,
    sent_at: "2026-11-16T00:00:00Z", accepted_at: null,
    token: "test-only-invitation", expires_at: "2099-12-31T00:00:00Z", revoked_at: null,
    ...overrides,
  };
}

async function openWizard(page: Page, players: Player[]) {
  const snapshot: z.infer<typeof storedOnboardingSchema> = {
    config: { name: "Navigation review", description: "Saved description", includeUsta: false, teamNumber: "", deadline: "" },
    players,
  };
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  await page.route("**/api/team-onboarding/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/friends")) return route.fulfill({ json: friends });
    if (["PUT", "POST"].includes(request.method())) {
      const body: unknown = request.postDataJSON();
      writes.push({ method: request.method(), path, body });
      if (request.method() === "PUT") {
        const input = saveOnboardingSchema.parse(body);
        snapshot.config = input.draft;
        // Match the persisted save contract: omitted players are removed;
        // correcting a revoked recipient clears issuance, but not revocation.
        snapshot.players = input.players.map(value => {
          const previous = snapshot.players.find(p => p.id === value.id) ?? player(value.id, { sent_at: null });
          const associated = value.associatedAccountId ?? null;
          const recipientChanged = previous.associated_account_id !== associated ||
            previous.phone !== (value.phone || null) || previous.email !== (value.email || null);
          return {
            ...previous, name: value.name, phone: value.phone || null, email: value.email || null,
            associated_account_id: associated,
            associated_account_name: friends.find(friend => friend.id === associated)?.name ?? null,
            confirmed_at: value.confirmedAt,
            ...(previous.revoked_at && recipientChanged ? { sent_at: null, token: "corrected-test-only-invitation" } : {}),
          };
        });
        return route.fulfill({ json: { ok: true } });
      }
      if (path.endsWith("/revoke")) {
        const input = z.object({ playerId: z.uuid(), renew: z.boolean().default(false) }).parse(body);
        snapshot.players = snapshot.players.map(p => p.id !== input.playerId ? p : input.renew
          ? { ...p, token: "replacement-test-only-invitation", revoked_at: null, sent_at: null }
          : { ...p, revoked_at: "2026-11-16T01:00:00Z" });
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ status: 400, json: { error: "Delivery is disabled in this fixture" } });
    }
    return route.fulfill({ json: snapshot });
  });
  await page.goto("/onboarding-preview?flow=team");
  await expect(page.getByRole("heading", { name: snapshot.config.name, exact: true })).toBeVisible();
  return { snapshot, writes };
}

test("Back never overwrites a roster that changed after Overview loaded", async ({ page }) => {
  const first = player("44444444-4444-4444-8444-444444444441");
  const addedElsewhere = player("44444444-4444-4444-8444-444444444442", { name: "Added in another tab", email: "other@example.com" });
  const fixture = await openWizard(page, [first]);
  fixture.snapshot.players.push(addedElsewhere);
  for (const heading of ["Invite your players", "Add your players", "Create your team"]) {
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeFocused();
    expect(fixture.writes).toEqual([]);
    expect(fixture.snapshot.players).toEqual([first, addedElsewhere]);
  }
  await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
});

test("Back preserves draft edits until Continue explicitly saves them", async ({ page }) => {
  const fixture = await openWizard(page, [player("44444444-4444-4444-8444-444444444441")]);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("textbox", { name: /^Invitation message/ }).fill("Updated invitation");
  await page.getByLabel("Include USTA registration instructions", { exact: true }).check();
  await page.getByLabel("USTA team number", { exact: true }).fill("0000000000");
  await page.getByLabel("Registration deadline", { exact: true }).fill("2026-11-24");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Player name", { exact: true }).fill("New Player");
  await page.getByLabel("Email", { exact: true }).fill("new@example.com");
  await page.getByRole("button", { name: "Add player", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  expect(fixture.writes).toEqual([]);
  await page.getByRole("textbox", { name: /^Description/ }).fill("Updated description");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("New Player", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /^Invitation message/ })).toHaveValue("Updated invitation");
  await expect(page.getByLabel("Registration deadline", { exact: true })).toHaveValue("2026-11-24");
  await expect(page.locator("pre")).toContainText("Updated description");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Navigation review", exact: true })).toBeVisible();
  expect(fixture.snapshot.players).toHaveLength(2);
  expect(fixture.snapshot.config.invitationMessage).toBe("Updated invitation");
  expect(fixture.snapshot.config.deadline).toBe("2026-11-24");
  expect(fixture.writes.map(write => write.method)).toEqual(["PUT", "PUT", "PUT"]);
});

test("a corrected revoked invitation stays renewable", async ({ page }) => {
  const invited = player("44444444-4444-4444-8444-444444444441", {
    associated_account_id: wrongAccount, associated_account_name: "Wrong Account",
  });
  const fixture = await openWizard(page, [invited]);
  const row = page.getByRole("listitem").filter({ has: page.getByText(invited.name, { exact: true }) });
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Revoke invitation", exact: true }).click();
  await expect(row.getByText("Invitation revoked", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invite your players", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("combobox", { name: /Associate account for Invited Player/ }).selectOption(correctAccount);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invite your players", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Navigation review", exact: true })).toBeVisible();
  expect(fixture.snapshot.players[0]).toMatchObject({ associated_account_id: correctAccount, sent_at: null, revoked_at: expect.any(String) });
  await expect(row.locator("summary")).toHaveText("Manage invitation");
  await row.locator("summary").click();
  await expect(row.getByRole("button", { name: "Revoke invitation", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Prepare new invitation link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("old link no longer works");
  expect(fixture.snapshot.players[0]).toMatchObject({ revoked_at: null, sent_at: null, token: "replacement-test-only-invitation" });
  expect(fixture.writes.filter(write => write.method === "POST").map(write => write.body)).toEqual([
    { playerId: invited.id }, { playerId: invited.id, renew: true },
  ]);
  await expect(row.locator("summary")).toHaveCount(0);
});

for (const state of ["never issued", "joined"] as const) {
  test(`Manage invitation remains hidden for a player who ${state === "joined" ? "has joined" : "has never been issued an invitation"}`, async ({ page }) => {
    await openWizard(page, [player("44444444-4444-4444-8444-444444444441", state === "never issued"
      ? { sent_at: null }
      : { accepted_by: correctAccount, accepted_at: "2026-11-16T01:00:00Z", revoked_at: "2026-11-16T02:00:00Z" })]);
    await expect(page.getByLabel("Manage invitation for Invited Player", { exact: true })).toHaveCount(0);
  });
}
