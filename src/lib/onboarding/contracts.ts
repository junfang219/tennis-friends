import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import { registrationDraftSchema } from "@/lib/registrationOnboarding";

export const playerInputSchema = z.object({
  id: z.uuid(), name: z.string().trim().min(1).max(100),
  // Preserve legacy contacts when editing; new onboarding no longer asks for phones.
  phone: z.string().max(40).default("").transform(value => value ? parsePhoneNumberFromString(value, "US")?.number ?? value : "").refine(value => !value || Boolean(parsePhoneNumberFromString(value)?.isValid()), "Invalid phone number"),
  email: z.union([z.email(), z.literal("")]), associatedAccountId: z.uuid().nullable().optional(),
  // Postgres returns saved timestamptz values with an offset (+00:00).
  // Accept those as well as browser-generated Z timestamps on later saves.
  confirmedAt: z.iso.datetime({ offset: true }).nullable(),
});
export const saveOnboardingSchema = z.object({
  draft: registrationDraftSchema.omit({ players: true }).extend({ name: z.string().trim().min(1).max(100) }),
  players: z.array(playerInputSchema).max(100),
}).superRefine((value, ctx) => {
  for (const key of ["id", "phone", "email", "associatedAccountId"] as const) {
    const values = value.players.map(p => p[key]).filter(Boolean);
    if (new Set(values).size !== values.length) ctx.addIssue({ code: "custom", message: `Duplicate player ${key}` });
  }
});
export const storedPlayerSchema = z.object({
  id: z.uuid(), group_id: z.uuid(), member_id: z.uuid().nullable(), name: z.string(), phone: z.string().nullable(), email: z.string().nullable(),
  associated_account_id: z.uuid().nullable(), associated_account_name: z.string().nullable(), accepted_by: z.uuid().nullable(),
  confirmed_at: z.string().nullable(), sent_at: z.string().nullable(), accepted_at: z.string().nullable(), token: z.string(),
  expires_at: z.string(), revoked_at: z.string().nullable(),
});
export const storedOnboardingSchema = z.object({ config: registrationDraftSchema.omit({ players: true }), players: z.array(storedPlayerSchema) });
export const publicInvitationSchema = z.object({
  groupId: z.uuid(), name: z.string(), description: z.string(), playerName: z.string(),
  associatedAccountId: z.uuid().nullable(), associatedAccountName: z.string().nullable(),
  acceptedBy: z.uuid().nullable(), status: z.enum(["pending", "accepted", "expired", "revoked"]),
  includeUsta: z.boolean(), ustaTeamName: z.string(), teamNumber: z.string(), deadline: z.string(), includeRegistrationLink: z.boolean(),
});
