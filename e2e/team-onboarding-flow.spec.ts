import { expect, test } from "@playwright/test";
import { groupId, playerId, managementFixture, player } from "./helpers/team-management";
test("two-step setup defaults to SMS and can finish without sending invitations", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  await page.goto("/groups/new");
  await expect(page.getByRole("link", { name: "Close team details", exact: true })).toHaveAttribute("href", "/groups");
  await expect(page.getByRole("textbox", { name: /player names/i })).toHaveCount(0);
  await expect(page.getByLabel("Team setup").getByText("1. Team details", { exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByLabel("Team setup").getByText("2. Invite players", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Is your USTA roster complete?", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Import a USTA team", exact: true })).toHaveAttribute("href", "/groups?setup=existing");
  await page.getByLabel("Team name", { exact: true }).fill("Slice Society");
  await page.getByRole("textbox", { name: /^Description/ }).fill("Our tennis team");
  await expect(page.getByLabel("Email", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await page.screenshot({ path: `/tmp/tennis-create-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Create team & continue", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/invite-players\\?setup=1$`));
  await expect(page.getByRole("button", { name: "Send by SMS", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Send by email", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share a team link instead", exact: true })).toBeVisible();
  await expect(page.getByLabel("Team invitation link", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create shared team link", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Team setup").getByText("2. Invite players", { exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("link", { name: "Go to Roster", exact: true })).toBeInViewport({ ratio: 1 });
  await page.reload();
  await expect(page.getByRole("navigation", { name: "Setup navigation" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Setup navigation" });
  await expect(page.getByRole("textbox", { name: "Phone number", exact: true })).toBeVisible();
  const back = await nav.getByRole("link", { name: "Back", exact: true }).boundingBox();
  const finish = await nav.getByRole("link", { name: "Go to Roster", exact: true }).boundingBox();
  expect(back?.height).toBe(finish?.height); expect(back?.y).toBe(finish?.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/tennis-setup-invite-${test.info().project.name}.png`, fullPage: true });
  await nav.getByRole("link", { name: "Go to Roster", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
  await expect(page.getByRole("heading", { name: "Roster", exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([{
    path: `/api/team-onboarding/${groupId}/create`,
    method: "POST",
    body: { name: "Slice Society", description: "Our tennis team" },
  }]);
  await page.getByRole("link", { name: "Invite players", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Invite players", exact: true })).toBeVisible();
  await expect(page.getByLabel("Team setup")).toHaveCount(0);
});
test("Go to Roster stays available if invitation options fail to load", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  await page.route(`**/api/team-onboarding/${groupId}`, (route) => route.fulfill({
    status: 503,
    json: { error: "Could not load invitations" },
  }));
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Could not load invitations");
  const rosterLink = page.getByRole("link", { name: "Go to Roster", exact: true });
  await expect(rosterLink).toBeInViewport({ ratio: 1 });
  await rosterLink.click();
  await expect(page).toHaveURL(`/groups/${groupId}/roster`);
  expect(fixture.writes).toEqual([]);
});
test("method switching and Back to roster never write a stale roster", async ({ context, page }) => {
  const fixture = await managementFixture(context, [player()]);
  await page.goto(`/groups/${groupId}/roster`);
  await page.getByRole("link", { name: "Invite players", exact: true }).click();
  await expect(page).toHaveURL(`/groups/${groupId}/invite-players`);
  fixture.state.players.push(player("77777777-7777-4777-8777-777777777777", { name: "Added elsewhere", email: "other@example.com" }));
  await page.getByRole("button", { name: "Send by email", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("draft@example.com");
  await page.getByRole("link", { name: "Back to roster", exact: true }).click();
  await expect(page).toHaveURL(`/groups/${groupId}/roster`);
  await expect(page.getByRole("heading", { name: "Roster", exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([]); expect(fixture.state.players).toHaveLength(2);
});

test("Back to roster reopens the Roster tab for invitations started in Settings", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  const teamPath = `/groups/${groupId}`;
  await page.goto(`${teamPath}/settings`);
  const roster = page.getByRole("tab", { name: "Roster", exact: true });
  await roster.click();
  await page.getByRole("link", { name: "Invite players", exact: true }).click();
  await expect(page).toHaveURL(`${teamPath}/invite-players?from=settings`);
  await expect(page.getByRole("heading", { name: "Invite players", exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("link", { name: "Back to roster", exact: true }).click();
  await expect(page).toHaveURL(`${teamPath}/settings?tab=roster`);
  await expect(roster).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Roster" })).toBeVisible();
  await page.reload();
  await expect(roster).toHaveAttribute("aria-selected", "true");
  expect(fixture.writes).toEqual([]);
});
test("email contacts are requested only for email, and sending targets only the new recipients", async ({ context, page }) => {
  const fixture = await managementFixture(context, [player()]);
  await page.goto(`/groups/${groupId}/invite-players`);
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Send by email", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Phone number", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("email@example.com");
  await page.getByRole("button", { name: "Add another email", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).nth(1).fill("second@example.com");
  await page.screenshot({ path: `/tmp/tennis-invite-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Send invitations", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2 emails accepted");
  const send = fixture.writes.find(w => w.path.endsWith("/send"))?.body as { playerIds: string[] };
  expect(send.playerIds).toHaveLength(2); expect(send.playerIds).not.toContain(playerId);
  expect(fixture.state.players).toHaveLength(3);
});
test("correcting a revoked recipient retains renewal and never changes confirmations", async ({ context, page }) => {
  const fixture = await managementFixture(context, [player(playerId, { confirmed_at: "2026-11-17T00:00:00Z", revoked_at: "2026-11-17T00:00:00Z" })]);
  await page.goto(`/groups/${groupId}/invite-players`);
  await page.getByRole("button", { name: "Edit recipient for Invited Player", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("corrected@example.com");
  await page.getByRole("button", { name: "Save recipient", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Recipient updated.");
  expect(fixture.state.players[0]).toMatchObject({ sent_at: null, revoked_at: expect.any(String), confirmed_at: "2026-11-17T00:00:00Z" });
  await page.getByLabel("Manage invitation for Invited Player", { exact: true }).click();
  await page.getByRole("button", { name: "Prepare new invitation link", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("old link no longer works");
});
for (const state of ["never-issued", "joined"] as const) test(`Manage invitation is hidden for ${state} players`, async ({ context, page }) => {
  await managementFixture(context, [player(playerId, state === "joined" ? { accepted_by: "55555555-5555-4555-8555-555555555555" } : { sent_at: null })]);
  await page.goto(`/groups/${groupId}/invite-players`);
  await expect(page.getByLabel("Manage invitation for Invited Player", { exact: true })).toHaveCount(0);
});
test("USTA is separate: configure, Confirm → Undo, and remind only unconfirmed players", async ({ context, page }) => {
  const fixture = await managementFixture(context, [player()]);
  await page.goto(`/groups/${groupId}/registration`);
  await page.getByLabel("Enable USTA registration", { exact: true }).check();
  await page.getByLabel("USTA team number", { exact: true }).fill("0000000000");
  await page.getByLabel("Registration deadline", { exact: true }).fill("2026-11-24");
  await page.getByRole("button", { name: "Save registration details", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("USTA registration settings saved.");
  await page.getByRole("button", { name: "Confirm registration for Invited Player", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send email reminders", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Undo confirmation for Invited Player", exact: true }).click();
  await page.getByRole("button", { name: "Prepare reminders to share", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Reminder for Invited Player", exact: true })).toContainText("0000000000");
  await page.screenshot({ path: `/tmp/tennis-registration-${test.info().project.name}.png`, fullPage: true });
  expect(fixture.state.players[0].confirmed_at).toBeNull();
  expect(fixture.writes.every(w => w.method !== "PUT")).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("previous invitations remain visible with their roles and cancellation controls", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  fixture.state.legacyInvitations.push({ id: playerId, email: "legacy@example.com", token: "old-token", roles: ["captain"], memberType: "Sub" });
  await page.goto(`/groups/${groupId}/invite-players`);
  await expect(page.getByText("legacy@example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("Existing invitation · captain · Sub", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel existing invitation", exact: true }).click();
  await expect(page.getByText("legacy@example.com", { exact: true })).toHaveCount(0);
});

test("team settings switches to the managed roster without navigating", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  fixture.state.config = { ...fixture.state.config, includeUsta: true, teamNumber: "0000000000", deadline: "2026-11-24" };
  fixture.state.members.push({ id: "88888888-8888-4888-8888-888888888888", userId: "11111111-1111-4111-8111-111111111111", name: "Captain" });
  const url = `/groups/${groupId}/settings`;
  await page.goto(url);

  const rosterTab = page.getByRole("tab", { name: "Roster", exact: true });
  await rosterTab.click();
  await expect(rosterTab).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "Roster" });
  const confirmation = panel.getByRole("checkbox", { name: "USTA registration confirmed for Captain", exact: true });
  await confirmation.check();
  await panel.getByText("USTA registration · 1 of 1 confirmed", { exact: true }).click();
  await expect(panel.getByLabel("USTA team number", { exact: true })).toHaveValue("0000000000");
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  for (const tab of ["Seasons", "Notifications", "Team"]) {
    const control = page.getByRole("tab", { name: tab, exact: true });
    await control.click();
    await expect(control).toHaveAttribute("aria-selected", "true");
    await expect(panel).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${url}$`));
  }
  await page.getByRole("tab", { name: "Team", exact: true }).press("ArrowRight");
  await expect(rosterTab).toBeFocused();
  await expect(panel).toBeVisible();
  await expect(confirmation).toBeChecked();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
});

test("captains can check and uncheck USTA registration directly in the roster", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  const ownerMember = "88888888-8888-4888-8888-888888888888", owner = "11111111-1111-4111-8111-111111111111";
  fixture.state.config = { ...fixture.state.config, includeUsta: true, teamNumber: "0000000000", deadline: "2026-11-24" };
  fixture.state.members.push({ id: ownerMember, userId: owner, name: "Captain" });
  fixture.state.players.push(player(playerId, { member_id: ownerMember, name: "Captain", accepted_by: owner, associated_account_id: owner }));
  await page.goto(`/groups/${groupId}/roster`);
  const members = page.getByRole("region", { name: "Team members", exact: true });
  const confirmation = members.getByRole("checkbox", { name: "USTA registration confirmed for Captain", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).not.toBeChecked();
  await confirmation.check();
  await expect(page.getByText("USTA registration · 1 of 1 confirmed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(confirmation).toBeChecked();
  await confirmation.uncheck();
  await page.getByText("USTA registration · 0 of 1 confirmed", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration details", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registration confirmations", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Prepare reminders to share", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Reminder for Captain", exact: true })).toBeVisible();
  expect(fixture.writes.filter(w => w.path.endsWith("/send")).map(w => w.body)).toEqual([expect.objectContaining({ reminder: true, mode: "prepare" })]);
  await confirmation.check();
  await expect(page.getByRole("textbox", { name: "Reminder for Captain", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/tennis-rosters-registration-${test.info().project.name}.png`, fullPage: true, animations: "disabled" });

  await page.route(`**/api/team-onboarding/${groupId}`, route => route.fulfill({ status: 403, json: { error: "Could not save confirmation" } }), { times: 1 });
  await confirmation.click();
  await expect(members.getByRole("alert")).toHaveText("Could not save confirmation");
  await expect(confirmation).toBeChecked();
});

test("Back edits the same team's details without replacing roster, USTA settings, or shared link", async ({ context, page }) => {
  const fixture = await managementFixture(context, [player()]);
  fixture.shared.token = "a".repeat(64); fixture.shared.enabled = true;
  fixture.state.config = { ...fixture.state.config, includeUsta: true, teamNumber: "0000000000", deadline: "2026-11-24" };
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByRole("navigation", { name: "Setup navigation" }).getByRole("link", { name: "Back", exact: true }).click();
  await expect(page.getByRole("link", { name: "Close team details", exact: true })).toHaveAttribute("href", "/groups");
  await expect(page.getByLabel("Team name", { exact: true })).toHaveValue("Shared review");
  await expect(page.getByRole("textbox", { name: /^Description/ })).toHaveValue("Saved description");
  await page.getByLabel("Team name", { exact: true }).fill("Updated team");
  await page.getByRole("textbox", { name: /^Description/ }).fill("Updated description");
  fixture.state.players.push(player("77777777-7777-4777-8777-777777777777"));
  await page.getByRole("button", { name: "Save & continue", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/invite-players\\?setup=1$`));
  expect(fixture.writes).toEqual([{ path: `/api/team-onboarding/${groupId}/create`, method: "PATCH", body: { name: "Updated team", description: "Updated description" } }]);
  expect(fixture.state.players).toHaveLength(2);
  expect(fixture.state.config).toMatchObject({ includeUsta: true, teamNumber: "0000000000", deadline: "2026-11-24" });
  expect(fixture.shared).toMatchObject({ enabled: true, token: "a".repeat(64) });
});
test("successful setup email sending finishes on Roster and targets only new recipients", async ({ context, page }) => {
  const fixture = await managementFixture(context, [player()]);
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByRole("button", { name: "Send by email", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("new@example.com");
  await page.getByRole("button", { name: "Share a team link instead", exact: true }).click();
  await page.getByRole("button", { name: "Send by email", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue("new@example.com");
  expect(fixture.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
  const send = fixture.writes.find(w => w.path.endsWith("/send"))?.body as { playerIds: string[] };
  expect(send.playerIds).toHaveLength(1); expect(send.playerIds).not.toContain(playerId);
});
for (const result of ["failed", "pending"] as const) test(`setup email ${result} stays on step two for review`, async ({ context, page }) => {
  const fixture = await managementFixture(context);
  fixture.controls[result === "failed" ? "emailFailed" : "emailPending"] = 1;
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByRole("button", { name: "Send by email", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("retry@example.com");
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(result === "failed" ? "1 failed" : "1 pending");
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/invite-players\\?setup=1$`));
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue("retry@example.com");
});

test("SMS is sent automatically to normalized phone-only recipients and finishes on Roster", async ({ context, page }) => {
 const fixture = await managementFixture(context, [player()]);
 await page.goto(`/groups/${groupId}/invite-players?setup=1`);
 await page.getByRole("textbox", {name:"Phone number",exact:true}).fill("(206) 555-0101");
 await page.getByRole("button",{name:"Add another phone number",exact:true}).click();
 await page.getByRole("textbox", {name:"Phone number",exact:true}).nth(1).fill("+44 20 7946 0018");
 await page.getByLabel("These players agreed to receive this team invitation by text.",{exact:true}).check();
 await page.screenshot({path:`/tmp/tennis-sms-invitations-${test.info().project.name}.png`,fullPage:true});
 await page.getByRole("button",{name:"Send invitations & finish",exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
 const request=fixture.writes.find(w=>w.path.endsWith("/send"))?.body as {mode:string;smsConsent:boolean;playerIds:string[]};
 expect(request).toMatchObject({mode:"sms",smsConsent:true});expect(request.playerIds).toHaveLength(2);expect(request.playerIds).not.toContain(playerId);
 expect(fixture.state.players.slice(1).map(p=>p.phone)).toEqual(["+12065550101","+442079460018"]);
 expect(fixture.writes.some(w=>w.method==="PUT")).toBe(false);
});
test("invalid and duplicate SMS numbers do not save or send",async({context,page})=>{
 const fixture=await managementFixture(context);await page.goto(`/groups/${groupId}/invite-players`);
 await page.getByRole("textbox",{name:"Phone number",exact:true}).fill("123");await page.getByLabel("These players agreed to receive this team invitation by text.",{exact:true}).check();
 await page.getByRole("button",{name:"Send SMS invitations",exact:true}).click();await expect(page.getByRole("main").getByRole("alert")).toContainText("valid phone");expect(fixture.writes).toHaveLength(0);
 await page.getByRole("textbox",{name:"Phone number",exact:true}).fill("2065550101");await page.getByRole("button",{name:"Add another phone number",exact:true}).click();await page.getByRole("textbox",{name:"Phone number",exact:true}).nth(1).fill("+12065550101");
 await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
 await page.getByRole("button",{name:"Send SMS invitations",exact:true}).click();await expect(page.getByRole("main").getByRole("alert")).toContainText("different phone number");expect(fixture.writes).toHaveLength(0);
});
test("SMS and email keep separate drafts and shared links remain secondary",async({context,page})=>{
 const fixture=await managementFixture(context);await page.goto(`/groups/${groupId}/invite-players`);
 await page.getByRole("textbox",{name:"Phone number",exact:true}).fill("2065550101");await page.getByRole("button",{name:"Send by email",exact:true}).click();
 await page.getByRole("textbox",{name:"Email",exact:true}).fill("draft@example.com");await page.getByRole("button",{name:"Share a team link instead",exact:true}).click();await expect(page.getByRole("button",{name:"Create shared team link",exact:true})).toBeVisible();
 await expect(page.getByRole("textbox",{name:"Phone number",exact:true})).toHaveCount(0);await page.getByRole("button",{name:"Send by SMS",exact:true}).click();await expect(page.getByRole("textbox",{name:"Phone number",exact:true})).toHaveValue("2065550101");
 await page.getByRole("button",{name:"Send by email",exact:true}).click();await expect(page.getByRole("textbox",{name:"Email",exact:true})).toHaveValue("draft@example.com");expect(fixture.writes).toHaveLength(0);
});
test("unconfigured SMS shows an error and keeps the captain on invitations",async({context,page})=>{
 const fixture=await managementFixture(context);fixture.controls.smsConfigured=false;await page.goto(`/groups/${groupId}/invite-players?setup=1`);
 await page.getByRole("textbox",{name:"Phone number",exact:true}).fill("2065550101");await page.getByLabel("These players agreed to receive this team invitation by text.",{exact:true}).check();await page.getByRole("button",{name:"Send invitations & finish",exact:true}).click();
 await expect(page.getByRole("main").getByRole("alert")).toContainText("Automatic SMS is not set up yet");expect(fixture.writes).toHaveLength(0);expect(fixture.state.players).toHaveLength(0);await expect(page.getByRole("textbox",{name:"Phone number",exact:true})).toHaveValue("2065550101");await expect(page.getByRole("heading",{name:"Invite players",exact:true})).toBeVisible();
});
test("pending SMS stays for review and a retry retains its delivery batch",async({context,page})=>{
 const fixture=await managementFixture(context);fixture.controls.smsPending=1;await page.goto(`/groups/${groupId}/invite-players?setup=1`);
 await page.getByRole("textbox",{name:"Phone number",exact:true}).fill("2065550101");await page.getByLabel("These players agreed to receive this team invitation by text.",{exact:true}).check();await page.getByRole("button",{name:"Send invitations & finish",exact:true}).click();await expect(page.getByRole("status")).toContainText("1 pending");
 await page.getByRole("button",{name:"Send by email",exact:true}).click();await page.getByRole("button",{name:"Send by SMS",exact:true}).click();await page.getByRole("button",{name:"Send invitations & finish",exact:true}).click();await expect(page.getByRole("status")).toContainText("1 pending");
 const sends=fixture.writes.filter(w=>w.path.endsWith("/send")).map(w=>w.body as {batchId:string});expect(sends).toHaveLength(2);expect(sends[0].batchId).toBe(sends[1].batchId);await expect(page.getByRole("heading",{name:"Invite players",exact:true})).toBeVisible();
});

for (const delivery of ["sms", "email"] as const) test(`include USTA details with the ${delivery} invitation without leaving setup`, async ({ context, page }) => {
  const fixture = await managementFixture(context, [player(playerId, { confirmed_at: "2026-11-17T00:00:00Z" })]);
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  const include = page.getByLabel("Include USTA registration instructions", { exact: true });
  await expect(include).not.toBeChecked();
  await expect(page.getByLabel("USTA team number", { exact: true })).toHaveCount(0);
  await include.check();
  await page.getByLabel("USTA team name", { exact: true }).fill("TEST ONLY — USTA details");
  await page.getByLabel("USTA team number", { exact: true }).fill("0000000000");
  await page.getByLabel("Registration deadline", { exact: true }).fill("2026-11-24");
  await page.getByLabel("Include USTA registration link in invitation", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Send by email", exact: true }).click();
  await expect(page.getByLabel("USTA team number", { exact: true })).toHaveValue("0000000000");
  if (delivery === "sms") {
    await page.getByRole("button", { name: "Send by SMS", exact: true }).click();
    await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550101");
    await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  } else await page.getByRole("textbox", { name: "Email", exact: true }).fill("usta@example.com");
  expect(fixture.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/tennis-invite-usta-${delivery}-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
  expect(fixture.state.config).toMatchObject({ includeUsta: true, includeUstaInInvitations: true, ustaTeamName: "TEST ONLY — USTA details", teamNumber: "0000000000", deadline: "2026-11-24", includeRegistrationLink: false });
  expect(fixture.state.players[0].confirmed_at).toBe("2026-11-17T00:00:00Z");
  const registration = fixture.writes.findIndex(w => (w.body as { action?: string }).action === "registration");
  const send = fixture.writes.findIndex(w => w.path.endsWith("/send"));
  expect(registration).toBeGreaterThanOrEqual(0); expect(registration).toBeLessThan(send);
});
test("USTA details are required only when included and incomplete details never save or send", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550101");
  await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await page.getByLabel("Include USTA registration instructions", { exact: true }).check();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  expect(fixture.writes).toHaveLength(0);
  await expect(page.getByLabel("USTA team number", { exact: true })).toHaveAttribute("required", "");
  await page.getByLabel("Include USTA registration instructions", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
  expect(fixture.state.config.includeUsta).toBe(false);
  expect(fixture.writes.some(w => (w.body as { action?: string }).action === "registration")).toBe(false);
});
test("omitting USTA instructions keeps existing registration tracking enabled", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  fixture.state.config = { ...fixture.state.config, includeUsta: true, teamNumber: "0000000000", deadline: "2026-11-24" };
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByLabel("Include USTA registration instructions", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Send by email", exact: true }).click();
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("omit@example.com");
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
  expect(fixture.state.config).toMatchObject({ includeUsta: true, includeUstaInInvitations: false, teamNumber: "0000000000", deadline: "2026-11-24" });
  expect(fixture.writes.some(w => (w.body as { action?: string }).action === "registration")).toBe(false);
});

test("an unsent SMS draft can be corrected in the same form after a configuration failure", async ({ context, page }) => {
  const fixture = await managementFixture(context, [player(playerId, { phone: "+12065550101", email: null, sent_at: null, name: "Original draft" })]); fixture.controls.smsConfigured = false;
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550101");
  await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Automatic SMS is not set up yet");
  const originalId = fixture.state.players[0].id;
  expect(fixture.messages).toHaveLength(0);
  await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550102");
  await page.getByRole("textbox", { name: "Name (optional)", exact: true }).fill("Corrected player");
  fixture.controls.smsConfigured = true;
  await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
  expect(fixture.state.players).toHaveLength(1); expect(fixture.state.players[0]).toMatchObject({ id: originalId, name: "Corrected player", phone: "+12065550102" });
  expect(fixture.messages).toMatchObject([{ address: "+12065550102", playerId: originalId }]);
});
test("a pending SMS cannot be redirected by editing the retry form", async ({ context, page }) => {
  const fixture = await managementFixture(context); fixture.controls.smsPending = 1;
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550101");
  await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 pending");
  await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550102");
  await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Review the pending SMS");
  expect(fixture.messages).toHaveLength(1); expect(fixture.state.players[0].phone).toBe("+12065550101");
});
test("two tabs retain their own USTA choice when invitation requests overlap", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  let release: () => void = () => {}; let arrived: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { arrived = resolve; });
  let first = true;
  await context.route(`**/api/team-onboarding/${groupId}/send`, async route => {
    if (first) { first = false; arrived(); await held; }
    await route.fallback();
  });
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550101");
  await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await started;
  const other = await context.newPage(); await other.goto(`/groups/${groupId}/invite-players?setup=1`);
  await other.getByLabel("Include USTA registration instructions", { exact: true }).check();
  await other.getByLabel("USTA team number", { exact: true }).fill("2222222222");
  await other.getByLabel("Registration deadline", { exact: true }).fill("2026-12-04");
  await other.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550102");
  await other.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await other.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(other).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
  release(); await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
  expect(fixture.messages.find(m => m.address === "+12065550101")?.message).not.toContain("USTA team:");
  expect(fixture.messages.find(m => m.address === "+12065550102")?.message).toContain("Team number: 2222222222");
});

test("a pending retry does not replace this tab's draft with another captain's preferences", async ({ context, page }) => {
  const fixture = await managementFixture(context); fixture.controls.smsPending = 1;
  fixture.state.config.invitationMessage = "Captain A invitation";
  await page.goto(`/groups/${groupId}/invite-players?setup=1`);
  await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550101");
  await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 pending");
  fixture.state.config = { ...fixture.state.config, invitationMessage: "Captain B invitation", includeUsta: true, includeUstaInInvitations: true, teamNumber: "2222222222", deadline: "2026-12-04" };
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 pending");
  await expect(page.getByLabel("Include USTA registration instructions", { exact: true })).not.toBeChecked();
  await page.getByText("Customize message", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Invitation message", exact: true })).toHaveValue("Captain A invitation");
  expect(fixture.messages).toHaveLength(1);
  const sends = fixture.writes.filter(w => w.path.endsWith("/send")).map(w => w.body as {batchId:string});
  expect(sends).toHaveLength(2); expect(sends[0].batchId).toBe(sends[1].batchId);
});

test("re-entering a saved unissued phone after reload reuses its existing draft and name", async ({ context, page }) => {
 const fixture = await managementFixture(context, [player(playerId, {name:"Saved player",phone:"+12065550101",email:null,sent_at:null})]);
 await page.goto(`/groups/${groupId}/invite-players?setup=1`);
 await page.getByRole("textbox", {name:"Phone number",exact:true}).fill("(206) 555-0101");
 await page.getByLabel("These players agreed to receive this team invitation by text.",{exact:true}).check();
 await page.getByRole("button",{name:"Send invitations & finish",exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/roster$`));
 expect(fixture.state.players).toHaveLength(1);expect(fixture.state.players[0]).toMatchObject({id:playerId,name:"Saved player"});
 expect(fixture.messages).toHaveLength(1);expect(fixture.messages[0].playerId).toBe(playerId);
});
test("SMS requires a public invitation address before changing recipients", async ({ context, page }) => {
 const fixture = await managementFixture(context);fixture.controls.smsPublicOrigin = false;
 await page.goto(`/groups/${groupId}/invite-players?setup=1`);
 await expect(page.getByRole("note")).toContainText("public app address");
 await page.getByRole("textbox", {name:"Phone number",exact:true}).fill("2065550101");
 await page.getByLabel("These players agreed to receive this team invitation by text.",{exact:true}).check();
 await page.getByRole("button",{name:"Send invitations & finish",exact:true}).click();
 await expect(page.getByRole("main").getByRole("alert")).toContainText("public app address");expect(fixture.writes).toHaveLength(0);
});

for (const delivery of ["sms", "email"] as const) test(`renew an expired unissued ${delivery} invitation without replacing the player`, async ({ context, page }) => {
  const original = player(playerId, { sent_at: null, expires_at: "2000-01-01T00:00:00Z", phone: delivery === "sms" ? "+12065550101" : null, email: delivery === "email" ? "expired@example.com" : null, confirmed_at: "2026-11-15T00:00:00Z" });
  const fixture = await managementFixture(context, [original]);
  const before = structuredClone(original);
  await page.goto(`/groups/${groupId}/invite-players`);
  await expect(page.getByText("This invitation expired before it was issued.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: `${delivery === "sms" ? "Send SMS" : "Send email"} to Invited Player`, exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Manage invitation for Invited Player", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Renew expired invitation for Invited Player", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("New personal link prepared");
  expect(fixture.state.players).toHaveLength(1);
  expect(fixture.state.players[0]).toEqual({ ...before, token: "d".repeat(64), expires_at: "2099-12-31T00:00:00Z" });
  expect(fixture.messages).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Renew expired invitation for Invited Player", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Manage invitation for Invited Player", { exact: true })).toHaveCount(0);
  if (delivery === "sms") await page.getByLabel("Invited Player agreed to receive this invitation by text.", { exact: true }).check();
  await page.getByRole("button", { name: `${delivery === "sms" ? "Send SMS" : "Send email"} to Invited Player`, exact: true }).click();
  await expect(page.getByRole("status")).toContainText("1 " + (delivery === "sms" ? "texts" : "emails") + " accepted");
  expect(fixture.messages).toHaveLength(1);
  expect(fixture.messages[0].message).toContain(`/team-invitations/${"d".repeat(64)}`);
  expect(fixture.state.players[0].confirmed_at).toBe(before.confirmed_at);
  expect(fixture.writes.map(w => w.path.split("/").pop())).toEqual(["revoke", "send"]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("expired draft renewal cannot bypass an unresolved SMS", async ({ context, page }) => {
  const original = player(playerId, { sent_at: null, expires_at: "2000-01-01T00:00:00Z", phone: "+12065550101", email: null });
  const fixture = await managementFixture(context, [original]);
  fixture.pendingSms.add(playerId);
  const before = structuredClone(original);
  await page.goto(`/groups/${groupId}/invite-players`);
  await page.getByRole("button", { name: "Renew expired invitation for Invited Player", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("unresolved delivery");
  expect(fixture.state.players).toEqual([before]);
  expect(fixture.messages).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Renew expired invitation for Invited Player", exact: true })).toBeEnabled();
});

test("server-provided invitations render without waiting for a second browser read", async ({ context, page }) => {
  await managementFixture(context);
  let reads = 0;
  await context.route(`**/api/team-onboarding/${groupId}`, async route => {
    reads++;
    await route.fulfill({ status: 503, json: { error: "A redundant read must not block the form" } });
  });
  const html = await (await page.request.get("/onboarding-preview?flow=invite-ready")).text();
  expect(html).toContain("Text invitations");
  expect(html).not.toContain("Loading invitations");
  await page.goto("/onboarding-preview?flow=invite-ready");
  await expect(page.getByRole("textbox", { name: "Phone number", exact: true })).toBeVisible();
  await expect(page.getByText("Loading invitations…", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Send by email", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  expect(reads).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("server-seeded invitations still check fresh SMS readiness before saving recipients", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  fixture.controls.smsConfigured = false;
  await page.goto("/onboarding-preview?flow=invite-ready");
  await page.getByRole("textbox", { name: "Phone number", exact: true }).fill("2065550101");
  await page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true }).check();
  await page.getByRole("button", { name: "Send invitations & finish", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Automatic SMS is not set up yet");
  expect(fixture.writes).toHaveLength(0);
  await expect(page.getByRole("textbox", { name: "Phone number", exact: true })).toHaveValue("2065550101");
});

test("creating a team navigates to step two once without refreshing it again", async ({ context, page }) => {
  const fixture = await managementFixture(context);
  const transitions: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === `/groups/${groupId}/invite-players` && request.headers()["rsc"] === "1") transitions.push(request.url());
  });
  await page.goto("/groups/new");
  await page.getByRole("textbox", { name: "Team name", exact: true }).fill("No extra refresh");
  await page.getByRole("button", { name: "Create team & continue", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Phone number", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/invite-players\\?setup=1$`));
  expect(transitions).toHaveLength(1);
  expect(fixture.writes.filter(write => write.path.endsWith("/create"))).toHaveLength(1);
});


test("SMS consent resets for number changes and is separate for a pending player", async ({ context, page }) => {
  const fixture = await managementFixture(context, [
    player(undefined, { name: "Pending Player", phone: "+12065550199", email: null }),
  ]);
  await page.goto(`/groups/${groupId}/invite-players`);
  const phone = page.getByRole("textbox", { name: "Phone number", exact: true });
  const consent = page.getByLabel("These players agreed to receive this team invitation by text.", { exact: true });
  const sendPending = page.getByRole("button", { name: "Send SMS to Pending Player", exact: true });

  await phone.fill("+12065550140");
  await consent.check();
  await expect(sendPending).toBeDisabled();

  await phone.fill("+12065550141");
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole("button", { name: "Add another phone number", exact: true }).click();
  await expect(consent).not.toBeChecked();

  await page.getByLabel("Pending Player agreed to receive this invitation by text.", { exact: true }).check();
  await sendPending.click();
  await expect(page.getByRole("status")).toContainText("1 texts accepted");
  await expect(sendPending).toBeDisabled();
  expect(fixture.messages.map(message => message.address)).toEqual(["+12065550199"]);
});
