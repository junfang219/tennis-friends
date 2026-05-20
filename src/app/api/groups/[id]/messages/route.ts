import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { emitToUsers } from "@/lib/eventBus";
import { pushToUsers } from "@/lib/push";
import { hasRole, ROLE } from "@/lib/groupRoles";
import { sendAnnouncementEmail } from "@/lib/announcementEmail";

function groupPreviewForPush(content: string, mediaUrl: string | undefined, mediaType: string | undefined): string {
  if (content && content.trim()) return content.trim().slice(0, 140);
  if (mediaUrl) return mediaType === "video" ? "🎥 Video" : "📷 Photo";
  return "New message";
}

async function verifyMembership(userId: string, groupId: string) {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  return !!membership;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  const member = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId: id, userId } },
  });
  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }
  const clearedAt = member.clearedAt || null;

  const messages = await prisma.groupMessage.findMany({
    where: {
      groupId: id,
      ...(clearedAt ? { createdAt: { gt: clearedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 200,
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

  // Hydrate shared posts
  const sharedPostIds = messages
    .filter((m) => m.sharedPostId)
    .map((m) => m.sharedPostId);

  const sharedPosts = sharedPostIds.length > 0
    ? await prisma.post.findMany({
        where: { id: { in: sharedPostIds } },
        include: {
          author: { select: { id: true, name: true, profileImageUrl: true } },
        },
      })
    : [];

  const postMap = new Map(sharedPosts.map((p) => [p.id, p]));

  // Bump lastReadAt so the inbox unread count clears
  await prisma.groupMember.update({
    where: { groupId_userId: { groupId: id, userId } },
    data: { lastReadAt: new Date() },
  });

  const reactionRows = messages.length
    ? await prisma.messageReaction.findMany({
        where: { messageType: "GROUP", messageId: { in: messages.map((m) => m.id) } },
        include: { user: { select: { id: true, name: true } } },
      })
    : [];
  const reactionsByMessage = new Map<string, { emoji: string; userId: string; userName: string }[]>();
  for (const r of reactionRows) {
    const list = reactionsByMessage.get(r.messageId) || [];
    list.push({ emoji: r.emoji, userId: r.userId, userName: r.user.name });
    reactionsByMessage.set(r.messageId, list);
  }

  const result = messages.map((m) => ({
    id: m.id,
    content: m.content,
    mediaUrl: m.mediaUrl || "",
    mediaType: m.mediaType || "",
    senderId: m.senderId,
    sharedPostId: m.sharedPostId || null,
    sharedPost: m.sharedPostId ? (postMap.get(m.sharedPostId) || null) : null,
    kind: m.kind,
    notifyEmail: m.notifyEmail,
    pinnedAt: m.pinnedAt,
    createdAt: m.createdAt,
    sender: m.sender,
    reactions: reactionsByMessage.get(m.id) || [],
  }));

  return NextResponse.json(result);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!(await verifyMembership(session.user.id, id))) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 });
  }

  const { content, mediaUrl, mediaType, sharedPostId, kind, notifyEmail } = await request.json();

  if (!content?.trim() && !mediaUrl && !sharedPostId) {
    return NextResponse.json({ error: "Content, media, or post required" }, { status: 400 });
  }

  // Announcement is a CAPTAIN+ action — sending broad notifications (and
  // optionally email) should not be a regular-member capability.
  const isAnnouncement = kind === "announcement";
  if (isAnnouncement) {
    if (!(await hasRole(id, session.user.id, ROLE.CAPTAIN))) {
      return NextResponse.json(
        { error: "Only a team captain can post announcements" },
        { status: 403 }
      );
    }
  } else if (kind !== undefined && kind !== "chat") {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  try {
    const message = await prisma.groupMessage.create({
      data: {
        content: (content || "").trim(),
        mediaUrl: mediaUrl || "",
        mediaType: mediaType || "",
        sharedPostId: sharedPostId || "",
        groupId: id,
        senderId: session.user.id,
        kind: isAnnouncement ? "announcement" : "chat",
        notifyEmail: isAnnouncement && notifyEmail === true,
        // Announcements are auto-pinned at create time so they stick to the
        // top of the chat panel UI. Regular chat stays unpinned.
        pinnedAt: isAnnouncement ? new Date() : null,
      },
      include: {
        sender: { select: { id: true, name: true, profileImageUrl: true } },
      },
    });

    let sharedPost = null;
    if (sharedPostId) {
      sharedPost = await prisma.post.findUnique({
        where: { id: sharedPostId },
        include: {
          author: { select: { id: true, name: true, profileImageUrl: true } },
        },
      });
    }

    // Notify every group member except the sender so their inbox/bell update.
    // Announcements bypass the per-member mute flag — they're explicit,
    // captain-authored notices that the team has opted into receiving by
    // being on the roster.
    const recipients = await prisma.groupMember.findMany({
      where: {
        groupId: id,
        userId: { not: session.user.id },
        ...(isAnnouncement ? {} : { muted: false }),
      },
      select: { userId: true },
    });
    const recipientIds = recipients.map((m) => m.userId);
    emitToUsers(recipientIds, { kind: "inbox" });

    const groupName = await prisma.group.findUnique({ where: { id }, select: { name: true } });
    void pushToUsers(recipientIds, {
      title: isAnnouncement
        ? `📣 ${groupName?.name || "Team"}`
        : (groupName?.name || "Group"),
      body: `${message.sender.name}: ${groupPreviewForPush(message.content, mediaUrl, mediaType)}`,
      threadId: `group:${id}`,
      data: { kind: "group", groupId: id },
    });

    // Optional Resend email fan-out for announcements. Fire-and-forget — a
    // failed send doesn't roll back the chat message.
    let emailDispatched = 0;
    if (isAnnouncement && message.notifyEmail) {
      const recipientUsers = await prisma.user.findMany({
        where: {
          id: { in: recipientIds },
          email: { not: null },
        },
        select: { id: true, email: true, name: true },
      });
      const emailList = recipientUsers
        .map((u) => u.email)
        .filter((e): e is string => typeof e === "string" && e.length > 0);
      emailDispatched = emailList.length;
      void sendAnnouncementEmail({
        to: emailList,
        teamName: groupName?.name || "Team",
        senderName: message.sender.name,
        content: message.content,
        teamUrl: `${new URL(request.url).origin}/groups/${id}/chat`,
      });
    }

    return NextResponse.json({
      id: message.id,
      content: message.content,
      mediaUrl: message.mediaUrl || "",
      mediaType: message.mediaType || "",
      senderId: message.senderId,
      sharedPostId: message.sharedPostId || null,
      sharedPost,
      kind: message.kind,
      notifyEmail: message.notifyEmail,
      pinnedAt: message.pinnedAt,
      createdAt: message.createdAt,
      sender: message.sender,
      reactions: [],
      ...(isAnnouncement ? { emailDispatched } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[POST /api/groups/[id]/messages] failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
