import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";

export const registrationPlayerSchema = z.object({
  id: z.string(), name: z.string().trim().min(1), phone: z.string(),
  email: z.union([z.email(), z.literal("")]).default(""),
  memberId: z.string().nullable().default(null),
  associatedAccountId: z.string().nullable().optional(),
  associatedAccountName: z.string().nullable().optional(),
  joinedAt: z.string().nullable().optional(),
  confirmedAt: z.string().nullable().default(null),
  invitedAt: z.string().nullable().default(null),
  remindedAt: z.string().nullable().default(null),
});
export const registrationDraftSchema = z.object({
  name: z.string().trim().min(1, "Enter a team name."),
  teamNumber: z.string().max(16),
  deadline: z.union([z.iso.date(), z.literal("")]),
  players: z.array(registrationPlayerSchema),
  invitationMessage: z.string().max(4000).optional(),
  description: z.string().max(2000).optional(),
  ustaTeamName: z.string().max(100).optional(),
  includeUsta: z.boolean().optional(),
  includeUstaInInvitations: z.boolean().optional(),
  // Retain the database compatibility field, but retire the old UI opt-out.
  // Missing flags already default to inclusion in the invitation lookup.
  includeDescription: z.boolean().transform((): boolean => true).optional(),
  includeRegistrationLink: z.boolean().optional(),
});
export type RegistrationDraft = z.infer<typeof registrationDraftSchema>;
export type RegistrationPlayer = z.infer<typeof registrationPlayerSchema>;
export const REGISTRATION_URL = "https://tennislink.usta.com/Leagues/TLRegistration/Registration.aspx";
export const blankRegistrationDraft = (): RegistrationDraft => ({ name: "", teamNumber: "", deadline: "", players: [], description: "", includeUsta: false, includeDescription: true, includeRegistrationLink: true });
export function formatDeadline(value: string) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "Deadline to be announced";
}
export function parseRegistrationPlayers(text: string): RegistrationPlayer[] {
  const seen = new Set<string>();
  return text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const [rawName, ...parts] = line.split(/,|\t/);
    const name = rawName.trim();
    const phone = parsePhoneNumberFromString(parts.join("").trim(), "US");
    if (!name || !phone?.isValid()) throw new Error(`Line ${index + 1}: enter a name and valid phone number, separated by a comma.`);
    if (seen.has(phone.number)) throw new Error(`Line ${index + 1}: this phone number is already listed.`);
    seen.add(phone.number);
    return registrationPlayerSchema.parse({ id: phone.number, name, phone: phone.number });
  });
}
export function registrationMessage(draft: RegistrationDraft, teamLink: string | null, reminder = false) {
  const lines = [reminder ? `Reminder: please register for ${draft.ustaTeamName || draft.name} on USTA.` : (draft.invitationMessage ?? `You're invited to join ${draft.name} on TennisFriends!`)];
  if (draft.description?.trim()) lines.push(draft.description.trim());
  if (draft.includeUsta !== false) {
    lines.push(`USTA team: ${draft.ustaTeamName || draft.name}`, `Team number: ${draft.teamNumber}`, `Register by: ${formatDeadline(draft.deadline)}`);
    if (draft.includeRegistrationLink !== false) lines.push(`Register: ${REGISTRATION_URL}`);
  }
  if (teamLink) lines.push(`Join the team: ${teamLink}`);
  return lines.join("\n\n");
}
export function invitationIssues(draft: RegistrationDraft): string[] {
  const issues: string[] = [];
  if (!draft.players.length) issues.push("Add at least one player.");
  if (draft.invitationMessage !== undefined && !draft.invitationMessage.trim()) issues.push("Enter an invitation message.");
  if (draft.includeUsta !== false) {
    if (!/^\d{10}$/.test(draft.teamNumber)) issues.push("Enter a 10-digit USTA team number.");
    if (!draft.deadline) issues.push("Choose a USTA registration deadline.");
  }
  return issues;
}

export function prepareRegistrationPlayer(value: { id: string; name: string; phone: string; email: string; memberId?: string | null }, players: RegistrationPlayer[]) {
  const phone = value.phone.trim() ? parsePhoneNumberFromString(value.phone.trim(), "US") : undefined;
  if (value.phone.trim() && !phone?.isValid()) throw new Error("Enter a valid phone number.");
  const result = registrationPlayerSchema.safeParse({ ...value, name: value.name.trim(), phone: phone?.number ?? "", email: value.email.trim().toLowerCase() });
  if (!result.success) throw new Error("Enter a name and a valid email address, if provided.");
  const player = result.data;
  if (players.some(p => (player.memberId && p.memberId === player.memberId) || (player.phone && p.phone === player.phone) || (player.email && p.email === player.email))) throw new Error("This player is already on your list.");
  return player;
}
export function registrationChannels(player: RegistrationPlayer) {
  return [player.email ? "Email" : "", player.memberId || player.associatedAccountId ? "In-app invitation" : ""].filter(Boolean).join(" + ") || "Shared team link";
}

// Review-only state transitions. Real acceptance must authenticate the account
// and validate the personal invitation credential on the server.
export function associateRegistrationAccount(players: RegistrationPlayer[], playerId: string, account: { id: string; name: string } | null): RegistrationPlayer[] {
  const player = players.find(p => p.id === playerId);
  if (!player) throw new Error("Player not found.");
  if (player.memberId) throw new Error("This player has already joined the team.");
  if (account && players.some(p => p.id !== playerId && (p.memberId === account.id || p.associatedAccountId === account.id))) throw new Error("This account is already associated with another player.");
  return players.map(p => p.id === playerId ? { ...p, associatedAccountId: account?.id ?? null, associatedAccountName: account?.name ?? null } : p);
}
export function acceptRegistrationInvitation(players: RegistrationPlayer[], playerId: string, account: { id: string; name: string } | null, now: string): RegistrationPlayer[] {
  if (!account || !z.object({ id: z.string().trim().min(1), name: z.string().trim().min(1) }).safeParse(account).success) throw new Error("Sign in to accept this invitation.");
  const player = players.find(p => p.id === playerId);
  if (!player?.invitedAt) throw new Error("Send this player's invitation first.");
  if (player.memberId && player.memberId !== account.id) throw new Error("This invitation has already been accepted by another account.");
  if (player.associatedAccountId && player.associatedAccountId !== account.id) throw new Error("Sign in with the account associated with this invitation, or ask the captain to correct it.");
  if (players.some(p => p.id !== playerId && (p.memberId === account.id || p.associatedAccountId === account.id))) throw new Error("This account is already associated with another player.");
  return players.map(p => p.id === playerId ? { ...p, associatedAccountId: account.id, associatedAccountName: account.name, memberId: account.id, joinedAt: p.joinedAt ?? now } : p);
}
