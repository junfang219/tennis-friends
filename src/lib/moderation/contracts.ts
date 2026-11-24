import { z } from "zod";

export const targetTypes = [
  "post", "comment", "direct_message", "chat_message", "team_message", "profile", "album", "album_item", "court_review",
] as const;
export type ReportTarget = (typeof targetTypes)[number];

const reasonKeys = ["harassment", "hate", "threat", "sexual", "spam", "other"] as const;
export const reportReasons: Record<(typeof reasonKeys)[number], string> = {
  harassment: "Harassment or bullying",
  hate: "Hate or discrimination",
  threat: "Threats or violence",
  sexual: "Sexual or explicit content",
  spam: "Spam or scams",
  other: "Something else",
};

export const targetLabels: Record<ReportTarget, string> = {
  post: "post",
  comment: "comment",
  direct_message: "direct message",
  chat_message: "group chat message",
  team_message: "team chat message",
  profile: "profile",
  album: "team album",
  album_item: "album attachment",
  court_review: "court review",
};

export const contentReportSchema = z.object({
  targetType: z.enum(targetTypes),
  targetId: z.uuid(),
  reason: z.enum(reasonKeys),
  details: z.string().trim().max(1000).default(""),
  blockAuthor: z.boolean().default(false),
}).strict().refine((report) => report.reason !== "other" || report.details.length > 0);

export const reviewDecisionSchema = z.object({
  reportId: z.uuid(),
  decision: z.enum(["dismissed", "removed", "retry_media"]),
});
