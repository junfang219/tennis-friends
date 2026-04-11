import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// PATCH set per-conversation flags (mute / pin / hide / clear) for the current user.
// Body: { type: "direct" | "group", id: string, action: "pin" | "unpin" | "mute" | "unmute" | "hide" | "unhide" | "leave" | "clear" }
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { type, id, action } = await request.json();

  if (!type || !id || !action) {
    return NextResponse.json({ error: "type, id, and action required" }, { status: 400 });
  }

  if (type === "direct") {
    // Update or upsert DirectMessageRead row
    const data: Record<string, unknown> = {};
    switch (action) {
      case "pin": data.pinnedAt = new Date(); break;
      case "unpin": data.pinnedAt = null; break;
      case "mute": data.muted = true; break;
      case "unmute": data.muted = false; break;
      case "hide":
      case "leave": // for direct chats, leave === hide
        data.hiddenAt = new Date();
        break;
      case "unhide": data.hiddenAt = null; break;
      case "clear":
        // Clear chat history from this user's view only.
        data.clearedAt = new Date();
        break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    await prisma.directMessageRead.upsert({
      where: { userId_otherId: { userId, otherId: id } },
      update: data,
      create: { userId, otherId: id, lastReadAt: new Date(), ...data },
    });

    return NextResponse.json({ success: true });
  }

  if (type === "group") {
    // For "leave", remove the participant; if last, delete the chat
    if (action === "leave") {
      const exists = await prisma.chatParticipant.findUnique({
        where: { chatId_userId: { chatId: id, userId } },
      });
      if (!exists) return NextResponse.json({ error: "Not a participant" }, { status: 403 });
      await prisma.chatParticipant.delete({
        where: { chatId_userId: { chatId: id, userId } },
      });
      const remaining = await prisma.chatParticipant.count({ where: { chatId: id } });
      if (remaining === 0) await prisma.chat.delete({ where: { id } });
      return NextResponse.json({ success: true });
    }

    const data: Record<string, unknown> = {};
    switch (action) {
      case "pin": data.pinnedAt = new Date(); break;
      case "unpin": data.pinnedAt = null; break;
      case "mute": data.muted = true; break;
      case "unmute": data.muted = false; break;
      case "hide": data.hiddenAt = new Date(); break;
      case "unhide": data.hiddenAt = null; break;
      case "clear": data.clearedAt = new Date(); break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const exists = await prisma.chatParticipant.findUnique({
      where: { chatId_userId: { chatId: id, userId } },
    });
    if (!exists) return NextResponse.json({ error: "Not a participant" }, { status: 403 });

    await prisma.chatParticipant.update({
      where: { chatId_userId: { chatId: id, userId } },
      data,
    });

    return NextResponse.json({ success: true });
  }

  if (type === "team") {
    // "leave" — remove the user from the team's GroupMember table.
    // Owner cannot leave (would orphan ownership). They must delete the team instead.
    if (action === "leave") {
      const exists = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: id, userId } },
      });
      if (!exists) return NextResponse.json({ error: "Not a member" }, { status: 403 });
      const team = await prisma.group.findUnique({ where: { id } });
      if (team?.ownerId === userId) {
        return NextResponse.json(
          { error: "Team owner cannot leave; delete the team instead" },
          { status: 400 }
        );
      }
      await prisma.groupMember.delete({
        where: { groupId_userId: { groupId: id, userId } },
      });
      return NextResponse.json({ success: true });
    }

    const data: Record<string, unknown> = {};
    switch (action) {
      case "pin": data.pinnedAt = new Date(); break;
      case "unpin": data.pinnedAt = null; break;
      case "mute": data.muted = true; break;
      case "unmute": data.muted = false; break;
      case "hide": data.hiddenAt = new Date(); break;
      case "unhide": data.hiddenAt = null; break;
      case "clear": data.clearedAt = new Date(); break;
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const exists = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId } },
    });
    if (!exists) return NextResponse.json({ error: "Not a member" }, { status: 403 });

    await prisma.groupMember.update({
      where: { groupId_userId: { groupId: id, userId } },
      data,
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}
