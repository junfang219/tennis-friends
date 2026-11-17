import { z } from "zod";

export const teamLinkTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const teamLinkActionSchema = z.object({ action: z.enum(["enable", "replace", "disable"]) });
export const reviewJoinRequestSchema = z.object({
  requestId: z.uuid(), decision: z.enum(["approve", "reject"]), playerId: z.uuid().nullable().default(null),
});
export const teamLinkStateSchema = z.object({
  token: teamLinkTokenSchema.nullable(), enabled: z.boolean(),
  requests: z.array(z.object({ id: z.uuid(), userId: z.uuid(), name: z.string(), email: z.string().nullable(), createdAt: z.string() })),
});
export const sharedTeamInvitationSchema = z.object({
  groupId: z.uuid(), name: z.string(), description: z.string(),
  status: z.enum(["signed_out", "ready", "pending", "rejected", "joined", "removed"]),
});
