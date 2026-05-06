import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/inbox/actions
 * Body: {
 *   type: "direct" | "group" | "team",
 *   id:   string,      // otherId for direct, chatId for group, groupId for team
 *   action: "pin" | "unpin" | "mute" | "unmute" | "hide" | "markUnread"
 * }
 *
 * Per-user-per-conversation state lives in:
 *   direct → DirectMessageRead  (upsert on userId + otherId)
 *   group  → ChatParticipant    (unique on chatId + userId)
 *   team   → GroupMember        (unique on groupId + userId)
 */

type InboxType = "direct" | "group" | "team";
type InboxAction = "pin" | "unpin" | "mute" | "unmute" | "hide" | "markUnread";

const VALID_TYPES: InboxType[] = ["direct", "group", "team"];
const VALID_ACTIONS: InboxAction[] = ["pin", "unpin", "mute", "unmute", "hide", "markUnread"];

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  let body: { type?: string; id?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const type = body.type as InboxType;
  const id = body.id;
  const action = body.action as InboxAction;

  if (!type || !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (!action || !VALID_ACTIONS.includes(action)) {
    return NextResponse.json({ error: `action must be one of ${VALID_ACTIONS.join(", ")}` }, { status: 400 });
  }

  // Build the field-diff for each action. For markUnread we compute the lastReadAt
  // against the most recent message in the conversation.
  const buildDataForAction = async (): Promise<Record<string, unknown>> => {
    switch (action) {
      case "pin":
        return { pinnedAt: new Date() };
      case "unpin":
        return { pinnedAt: null };
      case "mute":
        return { muted: true };
      case "unmute":
        return { muted: false };
      case "hide":
        return { hiddenAt: new Date() };
      case "markUnread": {
        // Find the most recent message in the conversation; set lastReadAt just before it
        // so the unread count comes out >= 1.
        let mostRecent: Date | null = null;
        if (type === "direct") {
          const msg = await prisma.message.findFirst({
            where: {
              OR: [
                { senderId: userId, receiverId: id },
                { senderId: id, receiverId: userId },
              ],
            },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          mostRecent = msg?.createdAt ?? null;
        } else if (type === "group") {
          const msg = await prisma.chatMessage.findFirst({
            where: { chatId: id },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          mostRecent = msg?.createdAt ?? null;
        } else {
          const msg = await prisma.groupMessage.findFirst({
            where: { groupId: id },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          mostRecent = msg?.createdAt ?? null;
        }
        if (!mostRecent) {
          // No messages — nothing to mark. Leave lastReadAt where it is.
          return {};
        }
        return { lastReadAt: new Date(mostRecent.getTime() - 1) };
      }
    }
  };

  const data = await buildDataForAction();

  try {
    if (type === "direct") {
      await prisma.directMessageRead.upsert({
        where: { userId_otherId: { userId, otherId: id } },
        update: data,
        create: {
          userId,
          otherId: id,
          ...data,
        },
      });
    } else if (type === "group") {
      // Must be a participant to act on the conversation
      const participant = await prisma.chatParticipant.findUnique({
        where: { chatId_userId: { chatId: id, userId } },
      });
      if (!participant) {
        return NextResponse.json({ error: "Not a participant of this chat" }, { status: 403 });
      }
      await prisma.chatParticipant.update({
        where: { chatId_userId: { chatId: id, userId } },
        data,
      });
    } else {
      const member = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: id, userId } },
      });
      if (!member) {
        return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
      }
      await prisma.groupMember.update({
        where: { groupId_userId: { groupId: id, userId } },
        data,
      });
    }
  } catch (err) {
    console.error("inbox/actions update failed:", err);
    return NextResponse.json({ error: "Failed to apply action" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
