import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// GET combined inbox: 1:1 conversations + group chats, with unread counts and per-conversation flags
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Lazy sweep: hard-delete session chats whose game ended more than 3 days
  // ago. Narrowed by postId != null so this only touches session chats; the
  // @@index([sessionEndAt]) keeps it cheap. Fire-and-forget — the request
  // doesn't need to wait for this maintenance write to finish.
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  prisma.chat
    .deleteMany({
      where: {
        postId: { not: null },
        sessionEndAt: { lt: threeDaysAgo },
      },
    })
    .catch((err) => {
      console.error("inbox sweep failed:", err);
    });

  // Helper: turn an empty-content media message into a friendly preview label
  const previewContent = (
    content: string,
    mediaUrl?: string | null,
    mediaType?: string | null
  ) => {
    if (content && content.trim()) return content;
    if (mediaUrl) return mediaType === "video" ? "🎥 Video" : "📷 Photo";
    return content;
  };

  // Three sections (direct / group / team) are independent — run them
  // concurrently so total latency is bounded by the slowest one rather than
  // the sum.
  const [directList, groupList, teamList] = await Promise.all([
    buildDirectList(userId, previewContent),
    buildGroupList(userId, previewContent),
    buildTeamList(userId, previewContent),
  ]);

  // Merge, drop nulls (hidden), sort: pinned first (by pinnedAt desc), then by latest activity desc
  const merged = [
    ...directList.filter((d): d is NonNullable<typeof d> => d !== null).map((d) => ({
      ...d,
      activityKey: new Date(d._sortAt).getTime(),
    })),
    ...groupList.filter((g): g is NonNullable<typeof g> => g !== null).map((g) => ({
      ...g,
      activityKey: new Date(g._sortAt).getTime(),
    })),
    ...teamList.filter((t): t is NonNullable<typeof t> => t !== null).map((t) => ({
      ...t,
      activityKey: new Date(t._sortAt).getTime(),
    })),
  ];

  merged.sort((a, b) => {
    const aPinned = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
    const bPinned = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    if (aPinned && bPinned) return bPinned - aPinned;
    return b.activityKey - a.activityKey;
  });

  // Total unread excludes muted conversations
  const totalUnread = merged.reduce(
    (sum, item) => sum + (item.muted ? 0 : item.unreadCount),
    0
  );

  return NextResponse.json({ items: merged, totalUnread });
}

type PreviewFn = (content: string, mediaUrl?: string | null, mediaType?: string | null) => string;

// Pick the per-conversation read cutoff (more recent of lastReadAt and clearedAt).
function readCutoff(lastReadAt: Date | null | undefined, clearedAt: Date | null | undefined): Date {
  const lr = lastReadAt || new Date(0);
  if (clearedAt && clearedAt > lr) return clearedAt;
  return lr;
}

async function buildDirectList(userId: string, previewContent: PreviewFn) {
  // Fetch recent messages (for previews) and per-conversation state in parallel.
  const [directMessages, directStates] = await Promise.all([
    prisma.message.findMany({
      where: { OR: [{ senderId: userId }, { receiverId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 500,
      include: {
        sender: { select: { id: true, name: true, profileImageUrl: true } },
        receiver: { select: { id: true, name: true, profileImageUrl: true } },
      },
    }),
    prisma.directMessageRead.findMany({ where: { userId } }),
  ]);

  type DirectConvo = {
    otherUser: { id: string; name: string; profileImageUrl: string };
    anyLatest: { content: string; createdAt: Date; senderId: string; mediaUrl: string; mediaType: string };
  };
  const conversations = new Map<string, DirectConvo>();
  for (const m of directMessages) {
    const otherId = m.senderId === userId ? m.receiverId : m.senderId;
    const otherUser = m.senderId === userId ? m.receiver : m.sender;
    if (!conversations.has(otherId)) {
      conversations.set(otherId, {
        otherUser,
        anyLatest: {
          content: m.content,
          createdAt: m.createdAt,
          senderId: m.senderId,
          mediaUrl: m.mediaUrl || "",
          mediaType: m.mediaType || "",
        },
      });
    }
  }

  const otherIds = Array.from(conversations.keys());
  const directStateByOther = new Map(
    directStates.filter((r) => otherIds.includes(r.otherId)).map((r) => [r.otherId, r])
  );

  // Per-conversation read cutoff. We then issue a single `findMany` for
  // every inbound message newer than the *minimum* cutoff, and bucket the
  // unread counts in JS — replacing N `count()` round-trips with 1.
  const cutoffByOther = new Map<string, Date>();
  for (const otherId of otherIds) {
    const state = directStateByOther.get(otherId);
    cutoffByOther.set(otherId, readCutoff(state?.lastReadAt, state?.clearedAt));
  }

  const unreadByOther = new Map<string, number>();
  if (otherIds.length > 0) {
    const minCutoff = new Date(
      Math.min(...Array.from(cutoffByOther.values()).map((d) => d.getTime()))
    );
    const candidates = await prisma.message.findMany({
      where: {
        receiverId: userId,
        senderId: { in: otherIds },
        createdAt: { gt: minCutoff },
      },
      select: { senderId: true, createdAt: true },
    });
    for (const m of candidates) {
      const cutoff = cutoffByOther.get(m.senderId);
      if (cutoff && m.createdAt > cutoff) {
        unreadByOther.set(m.senderId, (unreadByOther.get(m.senderId) || 0) + 1);
      }
    }
  }

  return Array.from(conversations.entries()).map(([otherId, convo]) => {
    const state = directStateByOther.get(otherId);
    const hiddenAt = state?.hiddenAt || null;
    const clearedAt = state?.clearedAt || null;

    // Hide conversations whose latest message is older than the user's hiddenAt
    if (hiddenAt && convo.anyLatest.createdAt <= hiddenAt) {
      return null;
    }

    // Visible last message: only if newer than clearedAt
    const visibleLatest =
      !clearedAt || convo.anyLatest.createdAt > clearedAt ? convo.anyLatest : null;

    return {
      type: "direct" as const,
      id: convo.otherUser.id,
      title: convo.otherUser.name,
      avatarUser: convo.otherUser,
      lastMessage: visibleLatest
        ? {
            content: previewContent(visibleLatest.content, visibleLatest.mediaUrl, visibleLatest.mediaType),
            createdAt: visibleLatest.createdAt,
            fromSelf: visibleLatest.senderId === userId,
          }
        : null,
      unreadCount: unreadByOther.get(otherId) || 0,
      muted: state?.muted || false,
      pinnedAt: state?.pinnedAt || null,
      href: `/chat/${convo.otherUser.id}`,
      // Sort by the actual latest message regardless of clearing, so cleared chats stay near the top until new activity arrives
      _sortAt: convo.anyLatest.createdAt,
    };
  });
}

async function buildGroupList(userId: string, previewContent: PreviewFn) {
  const myParticipations = await prisma.chatParticipant.findMany({ where: { userId } });
  const chatIds = myParticipations.map((p) => p.chatId);
  const stateByChat = new Map(myParticipations.map((p) => [p.chatId, p]));
  if (chatIds.length === 0) return [];

  // Fetch chat metadata + the candidate unread-message rows in parallel.
  const cutoffByChat = new Map<string, Date>();
  for (const p of myParticipations) {
    cutoffByChat.set(p.chatId, readCutoff(p.lastReadAt, p.clearedAt));
  }
  const minCutoff = new Date(
    Math.min(...Array.from(cutoffByChat.values()).map((d) => d.getTime()))
  );

  const [groupChats, unreadCandidates] = await Promise.all([
    prisma.chat.findMany({
      where: { id: { in: chatIds } },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, profileImageUrl: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { sender: { select: { id: true, name: true } } },
        },
      },
    }),
    prisma.chatMessage.findMany({
      where: {
        chatId: { in: chatIds },
        createdAt: { gt: minCutoff },
        senderId: { not: userId },
      },
      select: { chatId: true, createdAt: true },
    }),
  ]);

  const unreadByChat = new Map<string, number>();
  for (const m of unreadCandidates) {
    const cutoff = cutoffByChat.get(m.chatId);
    if (cutoff && m.createdAt > cutoff) {
      unreadByChat.set(m.chatId, (unreadByChat.get(m.chatId) || 0) + 1);
    }
  }

  return groupChats.map((chat) => {
    const state = stateByChat.get(chat.id);
    const clearedAt = state?.clearedAt || null;
    const anyLatest = chat.messages[0] || null;

    if (state?.hiddenAt && (!anyLatest || anyLatest.createdAt <= state.hiddenAt)) {
      return null;
    }

    const visibleLatest =
      anyLatest && (!clearedAt || anyLatest.createdAt > clearedAt) ? anyLatest : null;

    const others = chat.participants.filter((p) => p.userId !== userId).map((p) => p.user);
    const title = chat.name || others.map((u) => u.name.split(" ")[0]).join(", ") || "Group chat";
    const kind: "session" | "group" = chat.postId ? "session" : "group";
    return {
      type: "group" as const,
      id: chat.id,
      title,
      participants: others,
      kind,
      sessionEndAt: chat.sessionEndAt,
      lastMessage: visibleLatest
        ? {
            content: previewContent(visibleLatest.content, visibleLatest.mediaUrl, visibleLatest.mediaType),
            createdAt: visibleLatest.createdAt,
            fromSelf: visibleLatest.senderId === userId,
            senderName: visibleLatest.sender.name.split(" ")[0],
          }
        : null,
      unreadCount: unreadByChat.get(chat.id) || 0,
      muted: state?.muted || false,
      pinnedAt: state?.pinnedAt || null,
      href: `/chat/group/${chat.id}`,
      updatedAt: chat.updatedAt,
      _sortAt: anyLatest?.createdAt || chat.updatedAt,
    };
  });
}

async function buildTeamList(userId: string, previewContent: PreviewFn) {
  const myTeamMemberships = await prisma.groupMember.findMany({ where: { userId } });
  const teamIds = myTeamMemberships.map((m) => m.groupId);
  const teamStateById = new Map(myTeamMemberships.map((m) => [m.groupId, m]));
  if (teamIds.length === 0) return [];

  const cutoffByTeam = new Map<string, Date>();
  for (const m of myTeamMemberships) {
    cutoffByTeam.set(m.groupId, readCutoff(m.lastReadAt, m.clearedAt));
  }
  const minCutoff = new Date(
    Math.min(...Array.from(cutoffByTeam.values()).map((d) => d.getTime()))
  );

  const [teams, unreadCandidates] = await Promise.all([
    prisma.group.findMany({
      where: { id: { in: teamIds } },
      include: {
        members: {
          include: {
            user: { select: { id: true, name: true, profileImageUrl: true } },
          },
        },
        groupMessages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { sender: { select: { id: true, name: true } } },
        },
        event: { select: { id: true } },
      },
    }),
    prisma.groupMessage.findMany({
      where: {
        groupId: { in: teamIds },
        createdAt: { gt: minCutoff },
        senderId: { not: userId },
      },
      select: { groupId: true, createdAt: true },
    }),
  ]);

  const unreadByTeam = new Map<string, number>();
  for (const m of unreadCandidates) {
    const cutoff = cutoffByTeam.get(m.groupId);
    if (cutoff && m.createdAt > cutoff) {
      unreadByTeam.set(m.groupId, (unreadByTeam.get(m.groupId) || 0) + 1);
    }
  }

  return teams.map((team) => {
    const state = teamStateById.get(team.id);
    const clearedAt = state?.clearedAt || null;
    const anyLatest = team.groupMessages[0] || null;

    if (state?.hiddenAt && (!anyLatest || anyLatest.createdAt <= state.hiddenAt)) {
      return null;
    }

    const visibleLatest =
      anyLatest && (!clearedAt || anyLatest.createdAt > clearedAt) ? anyLatest : null;

    const others = team.members.filter((m) => m.userId !== userId).map((m) => m.user);
    return {
      type: "team" as const,
      id: team.id,
      title: team.name,
      participants: others,
      imageUrl: team.imageUrl || "",
      creatorId: team.ownerId,
      lastMessage: visibleLatest
        ? {
            content: previewContent(visibleLatest.content, visibleLatest.mediaUrl, visibleLatest.mediaType),
            createdAt: visibleLatest.createdAt,
            fromSelf: visibleLatest.senderId === userId,
            senderName: visibleLatest.sender.name.split(" ")[0],
          }
        : null,
      unreadCount: unreadByTeam.get(team.id) || 0,
      muted: state?.muted || false,
      pinnedAt: state?.pinnedAt || null,
      href: `/groups/${team.id}/chat`,
      updatedAt: team.updatedAt,
      _sortAt: anyLatest?.createdAt || team.updatedAt,
      eventId: team.event?.id ?? null,
    };
  });
}
