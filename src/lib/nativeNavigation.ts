import { z } from "zod";

const notificationSchema = z.object({
  kind: z.string(),
  from: z.uuid().optional(),
  messageId: z.uuid().optional(),
  groupId: z.uuid().optional(),
  chatId: z.uuid().optional(),
  pollId: z.uuid().optional(),
  courtId: z.string().min(1).optional(),
  teamId: z.uuid().optional(),
  refId: z.uuid().optional(),
});

export function notificationTarget(input: unknown): string | null {
  const result = notificationSchema.safeParse(input);
  if (!result.success) return null;
  const data = result.data;
  switch (data.kind) {
    case "dm": return data.from ? `/chat/${data.from}` : null;
    case "message_reaction":
      return data.from ? `/chat/${data.from}${data.messageId ? `?msg=${data.messageId}` : ""}` : null;
    case "group": return data.groupId ? `/groups/${data.groupId}/chat` : null;
    case "chat": return data.chatId ? `/chat/group/${data.chatId}` : null;
    case "availability_poll":
      return data.groupId && data.pollId ? `/groups/${data.groupId}/availability/polls/${data.pollId}` : null;
    case "match":
    case "practice":
      return data.teamId && data.refId
        ? `/groups/${data.teamId}/${data.kind === "match" ? "availability" : "practice"}?focus=${data.refId}`
        : null;
    case "club_invite": return "/friends/requests";
    case "court_available": return data.courtId ? `/courts/${encodeURIComponent(data.courtId)}` : null;
    default: return null;
  }
}

export function universalLinkTarget(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.origin !== "https://mytennisfriends.com" || url.pathname.startsWith("//")) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
