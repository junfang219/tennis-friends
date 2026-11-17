import { z } from "zod";
import { invitationPhoneSchema } from "./phone";
import { storedOnboardingSchema } from "./contracts";

export const createTeamSchema = z.object({ name: z.string().trim().min(1, "Enter a team name").max(100), description: z.string().trim().max(2000).default("") });
const email = z.string().trim().toLowerCase().pipe(z.email());
export const recipientSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100), email });
export const smsRecipientSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(100), phone: invitationPhoneSchema });
export const teamManagementMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("init") }),
  z.object({ action: z.literal("sms-recipients"), recipients: z.array(smsRecipientSchema).min(1).max(100) }),
  z.object({ action: z.literal("recipients"), recipients: z.array(recipientSchema).min(1).max(100) }),
  z.object({ action: z.literal("recipient"), playerId: z.uuid(), name: z.string().trim().min(1).max(100), email: z.union([email, z.literal("")]), associatedAccountId: z.uuid().nullable(), phone: invitationPhoneSchema.optional() }),
  z.object({ action: z.literal("message"), message: z.string().trim().min(1).max(4000), includeUstaInInvitations: z.boolean() }),
  z.object({ action: z.literal("registration"), includeUsta: z.boolean(), ustaTeamName: z.string().trim().max(100), teamNumber: z.string().trim().max(10), deadline: z.union([z.iso.date(), z.literal("")]), includeRegistrationLink: z.boolean() }).refine(v => !v.includeUsta || (/^\d{10}$/.test(v.teamNumber) && Boolean(v.deadline)), "Enter a 10-digit team number and deadline"),
  z.object({ action: z.literal("confirmation"), playerId: z.uuid(), confirmed: z.boolean() }),
  z.object({ action: z.literal("cancel-legacy"), inviteId: z.uuid() }),
]);
export const teamManagementStateSchema = storedOnboardingSchema.extend({
  members: z.array(z.object({ id: z.uuid(), userId: z.uuid().nullable(), name: z.string() })).default([]),
  legacyInvitations: z.array(z.object({ id: z.uuid(), email: z.string().nullable(), token: z.string(), roles: z.array(z.string()), memberType: z.string() })).default([]),
});
export type TeamManagementState = z.infer<typeof teamManagementStateSchema>;
export function registrationPlayers(state: TeamManagementState) {
  return [...state.players, ...state.members.filter(m => m.userId && !state.players.some(p => p.member_id === m.id || p.accepted_by === m.userId)).map(m => ({
    id: m.id, group_id: state.players[0]?.group_id ?? "", member_id: m.id, name: m.name, phone: null, email: null, associated_account_id: m.userId,
    associated_account_name: m.name, accepted_by: m.userId, confirmed_at: null, sent_at: null, accepted_at: null, token: "", expires_at: "", revoked_at: null,
  }))];
}
