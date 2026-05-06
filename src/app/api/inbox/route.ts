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
  // @@index([sessionEndAt]) keeps it cheap. onDelete: Cascade on
  // ChatParticipant / ChatMessage cleans up the rest.
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await prisma.chat.deleteMany({
    where: {
      postId: { not: null },
      sessionEndAt: { lt: threeDaysAgo },
    },
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

  // ---------- 1:1 direct conversations ----------
  const directMessages = await prisma.message.findMany({
    where: {
      OR: [{ senderId: userId }, { receiverId: userId }],
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    include: {
      sender: { select: { id: true, name: true, profileImageUrl: true } },
      receiver: { select: { id: true, name: true, profileImageUrl: true } },
    },
  });

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

  // Pull state rows for these conversations
  const otherIds = Array.from(conversations.keys());
  const directStates = otherIds.length
    ? await prisma.directMessageRead.findMany({
        where: { userId, otherId: { in: otherIds } },
      })
    : [];
  const directStateByOther = new Map(directStates.map((r) => [r.otherId, r]));

  const directList = await Promise.all(
    Array.from(conversations.entries()).map(async ([otherId, convo]) => {
      const state = directStateByOther.get(otherId);
      const lastReadAt = state?.lastReadAt || new Date(0);
      const hiddenAt = state?.hiddenAt || null;
      const clearedAt = state?.clearedAt || null;

      // Hide conversations whose latest message is older than the user's hiddenAt
      if (hiddenAt && convo.anyLatest.createdAt <= hiddenAt) {
        return null;
      }

      // Read cutoff is the more recent of lastReadAt and clearedAt
      const readCutoff = clearedAt && clearedAt > lastReadAt ? clearedAt : lastReadAt;

      const unread = await prisma.message.count({
        where: {
          senderId: otherId,
          receiverId: userId,
          createdAt: { gt: readCutoff },
        },
      });

      // Find the most recent visible message (after clearedAt) for the preview
      let visibleLatest: { content: string; createdAt: Date; senderId: string; mediaUrl: string; mediaType: string } | null = null;
      if (!clearedAt || convo.anyLatest.createdAt > clearedAt) {
        visibleLatest = convo.anyLatest;
      }

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
        unreadCount: unread,
        muted: state?.muted || false,
        pinnedAt: state?.pinnedAt || null,
        href: `/chat/${convo.otherUser.id}`,
        // Sort by the actual latest message regardless of clearing, so cleared chats stay near the top until new activity arrives
        _sortAt: convo.anyLatest.createdAt,
      };
    })
  );

  // ---------- Group chats ----------
  const myParticipations = await prisma.chatParticipant.findMany({
    where: { userId },
  });
  const chatIds = myParticipations.map((p) => p.chatId);
  const stateByChat = new Map(myParticipations.map((p) => [p.chatId, p]));

  const groupChats =
    chatIds.length > 0
      ? await prisma.chat.findMany({
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
        })
      : [];

  const groupList = await Promise.all(
    groupChats.map(async (chat) => {
      const state = stateByChat.get(chat.id);
      const lastReadAt = state?.lastReadAt || new Date(0);
      const clearedAt = state?.clearedAt || null;
      const anyLatest = chat.messages[0] || null;

      // Hide if user has hidden the chat AND no new message since
      if (state?.hiddenAt && (!anyLatest || anyLatest.createdAt <= state.hiddenAt)) {
        return null;
      }

      // Read cutoff is the more recent of lastReadAt and clearedAt
      const readCutoff = clearedAt && clearedAt > lastReadAt ? clearedAt : lastReadAt;

      const unreadCount = await prisma.chatMessage.count({
        where: {
          chatId: chat.id,
          createdAt: { gt: readCutoff },
          senderId: { not: userId },
        },
      });

      // Visible last message: only if newer than clearedAt
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
        unreadCount,
        muted: state?.muted || false,
        pinnedAt: state?.pinnedAt || null,
        href: `/chat/group/${chat.id}`,
        updatedAt: chat.updatedAt,
        // Sort by actual latest message regardless of clearing
        _sortAt: anyLatest?.createdAt || chat.updatedAt,
      };
    })
  );

  // ---------- Team chats (legacy Group/GroupMember/GroupMessage) ----------
  const myTeamMemberships = await prisma.groupMember.findMany({ where: { userId } });
  const teamIds = myTeamMemberships.map((m) => m.groupId);
  const teamStateById = new Map(myTeamMemberships.map((m) => [m.groupId, m]));

  const teams =
    teamIds.length > 0
      ? await prisma.group.findMany({
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
          },
        })
      : [];

  const teamList = await Promise.all(
    teams.map(async (team) => {
      const state = teamStateById.get(team.id);
      const lastReadAt = state?.lastReadAt || new Date(0);
      const clearedAt = state?.clearedAt || null;
      const anyLatest = team.groupMessages[0] || null;

      // Hide if user has hidden the team chat AND no new message since
      if (state?.hiddenAt && (!anyLatest || anyLatest.createdAt <= state.hiddenAt)) {
        return null;
      }

      // Read cutoff is the more recent of lastReadAt and clearedAt
      const readCutoff = clearedAt && clearedAt > lastReadAt ? clearedAt : lastReadAt;

      const unreadCount = await prisma.groupMessage.count({
        where: {
          groupId: team.id,
          createdAt: { gt: readCutoff },
          senderId: { not: userId },
        },
      });

      // Visible last message: only if newer than clearedAt
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
        unreadCount,
        muted: state?.muted || false,
        pinnedAt: state?.pinnedAt || null,
        href: `/groups/${team.id}/chat`,
        updatedAt: team.updatedAt,
        _sortAt: anyLatest?.createdAt || team.updatedAt,
      };
    })
  );

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
