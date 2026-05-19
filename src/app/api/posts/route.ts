import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ensureTeamGroup } from "@/lib/teamGroup";
import { haversineMiles } from "@/lib/distance";
import { rateLimit } from "@/lib/rateLimit";
import { getAcceptedFriendIds } from "@/lib/friendship";

const BROADCAST_RADII = [5, 10, 25] as const;
const MAX_BROADCAST_RADIUS = 25;
const DAY_MS = 24 * 60 * 60 * 1000;

function roundDistance(mi: number): number {
  return mi < 10 ? Math.round(mi * 10) / 10 : Math.round(mi);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // All six prefix lookups are independent — fire in parallel so the feed
  // pays the cost of the slowest one rather than the sum.
  const [
    friendIds,
    userGroupMemberships,
    userFriendGroupMemberships,
    hiddenPosts,
    blocks,
    me,
  ] = await Promise.all([
    getAcceptedFriendIds(userId),
    // Active memberships only — archived teams are hidden from the feed, so
    // posts targeted only to those teams won't surface.
    prisma.groupMember.findMany({
      where: { userId, archivedAt: null },
      select: { groupId: true },
    }),
    prisma.friendGroupMember.findMany({
      where: { userId },
      select: { friendGroupId: true },
    }),
    prisma.hiddenPost.findMany({
      where: { userId },
      select: { postId: true },
    }),
    prisma.block.findMany({
      where: {
        OR: [{ blockerId: userId }, { blockedId: userId }],
      },
    }),
    // Viewer coords power the broadcast bounding box and distance calc.
    // Viewers without a location can't match any broadcast — they simply
    // won't see any until they set one in their profile.
    prisma.user.findUnique({
      where: { id: userId },
      select: { latitude: true, longitude: true },
    }),
  ]);

  const userGroupIds = userGroupMemberships.map((m) => m.groupId);
  const userFriendGroupIds = userFriendGroupMemberships.map((m) => m.friendGroupId);
  const hiddenPostIds = hiddenPosts.map((h) => h.postId);
  const blockedUserIds = Array.from(
    new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)))
  );
  const haveMyLocation = me?.latitude != null && me?.longitude != null;

  // Bounding-box prefilter to keep the SQL query cheap; exact Haversine runs
  // in JS below since SQLite has no trig functions readily available.
  let broadcastClause: Prisma.PostWhereInput | null = null;
  if (haveMyLocation) {
    const latDelta = MAX_BROADCAST_RADIUS / 69; // ~1° lat = 69 mi
    const cosLat = Math.cos((me!.latitude as number) * Math.PI / 180);
    const lonDelta = MAX_BROADCAST_RADIUS / (69 * Math.max(0.01, cosLat));
    const myLat = me!.latitude as number;
    const myLng = me!.longitude as number;
    broadcastClause = {
      authorId: { notIn: [...friendIds, userId, ...blockedUserIds] },
      isBroadcast: true,
      isComplete: false,
      postGroups: { none: {} },
      postFriendGroups: { none: {} },
      broadcastLat: { gte: myLat - latDelta, lte: myLat + latDelta },
      broadcastLng: { gte: myLng - lonDelta, lte: myLng + lonDelta },
    };
  }

  // Fetch posts:
  // 1. Own posts (always visible)
  // 2. Friends' posts with NO group targeting (visible to all friends)
  // 3. Friends' posts targeted to groups the user is a member of
  const posts = await prisma.post.findMany({
    where: {
      id: hiddenPostIds.length > 0 ? { notIn: hiddenPostIds } : undefined,
      // Hide posts from blocked users (in either direction)
      ...(blockedUserIds.length > 0
        ? { authorId: { notIn: blockedUserIds } }
        : {}),
      OR: [
        // Own posts
        { authorId: userId },
        // Friends' posts with no targeting (visible to all friends)
        {
          authorId: { in: friendIds },
          postGroups: { none: {} },
          postFriendGroups: { none: {} },
        },
        // Friends' posts targeted to teams I'm in
        {
          authorId: { in: friendIds },
          postGroups: { some: { groupId: { in: userGroupIds } } },
        },
        // Friends' posts targeted to friend groups I'm in
        {
          authorId: { in: friendIds },
          postFriendGroups: { some: { friendGroupId: { in: userFriendGroupIds } } },
        },
        // Broadcasts from non-friends within range (bounding-box; exact
        // distance filtered post-fetch). Skipped entirely when viewer has
        // no location.
        ...(broadcastClause ? [broadcastClause] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      author: {
        select: { id: true, name: true, profileImageUrl: true },
      },
      likes: {
        where: { userId },
        select: { id: true },
      },
      postGroups: {
        include: {
          group: { select: { id: true, name: true } },
        },
      },
      postFriendGroups: {
        include: {
          friendGroup: { select: { id: true, name: true } },
        },
      },
      playRequests: {
        select: { id: true, status: true, note: true, userId: true, user: { select: { name: true, profileImageUrl: true } } },
      },
      photos: { orderBy: { order: "asc" }, select: { url: true } },
      event: {
        select: {
          id: true,
          title: true,
          eventType: true,
          startDate: true,
          endDate: true,
          venueName: true,
          maxParticipants: true,
          ntrpMin: true,
          ntrpMax: true,
          coverImageUrl: true,
          _count: { select: { participants: { where: { status: "registered" } } } },
        },
      },
      _count: { select: { likes: true, comments: true, playRequests: { where: { status: "PENDING" } } } },
    },
  });

  // Exact distance filter for broadcasts. The SQL bounding box keeps the
  // query cheap but lets in posts up to ~25mi away; here we tighten to each
  // post's own broadcastRadiusMi and stash the rounded distance for the UI.
  const distanceByPost = new Map<string, number>();
  const filteredPosts = posts.filter((post) => {
    if (!post.isBroadcast || post.authorId === userId || friendIds.includes(post.authorId)) {
      return true;
    }
    if (!haveMyLocation || post.broadcastLat == null || post.broadcastLng == null) {
      return false;
    }
    const d = haversineMiles(
      me!.latitude as number,
      me!.longitude as number,
      post.broadcastLat,
      post.broadcastLng
    );
    if (d > post.broadcastRadiusMi) return false;
    distanceByPost.set(post.id, d);
    return true;
  });

  // For every completed find-players post, look up its auto-created session
  // chat so the card can link straight to /chat/group/<id>. One bounded query.
  const completePostIds = filteredPosts
    .filter((p) => p.postType === "find_players" && p.isComplete)
    .map((p) => p.id);
  const sessionChats = completePostIds.length
    ? await prisma.chat.findMany({
        where: {
          postId: { in: completePostIds },
          participants: { some: { userId } },
        },
        select: { id: true, postId: true },
      })
    : [];
  const sessionChatByPost = new Map(
    sessionChats.map((c) => [c.postId as string, c.id])
  );

  // Back-fill: any complete propose_team post that doesn't have a team group
  // yet — create it lazily, but only when the viewer is a participant
  // (author or approved player). Catches posts that filled before this
  // feature shipped.
  const teamBackfillByPost = new Map<string, string>();
  const teamBackfillTargets = filteredPosts.filter(
    (p) =>
      p.postType === "propose_team" &&
      p.isComplete &&
      !p.teamGroupId &&
      (p.authorId === userId ||
        p.playRequests.some((r) => r.userId === userId && r.status === "APPROVED"))
  );
  for (const p of teamBackfillTargets) {
    try {
      const gid = await ensureTeamGroup(p.id);
      if (gid) teamBackfillByPost.set(p.id, gid);
    } catch (err) {
      console.error("ensureTeamGroup (feed back-fill) failed:", err);
    }
  }

  const formatted = filteredPosts.map((post) => ({
    id: post.id,
    content: post.content,
    mediaUrl: post.mediaUrl,
    mediaType: post.mediaType,
    photoUrls:
      post.photos.length > 0
        ? post.photos.map((p) => p.url)
        : post.mediaType === "image" && post.mediaUrl
        ? [post.mediaUrl]
        : [],
    postType: post.postType,
    playDate: post.playDate,
    playTime: post.playTime,
    playDuration: post.playDuration,
    courtLocation: post.courtLocation,
    gameType: post.gameType,
    playersNeeded: post.playersNeeded,
    skillMin: post.skillMin,
    skillMax: post.skillMax,
    playersConfirmed: post.playersConfirmed,
    courtBooked: post.courtBooked,
    isComplete: post.isComplete,
    isBroadcast: post.isBroadcast,
    broadcastRadiusMi: post.broadcastRadiusMi,
    distanceMiles: distanceByPost.has(post.id)
      ? roundDistance(distanceByPost.get(post.id) as number)
      : null,
    sessionChatId: sessionChatByPost.get(post.id) || null,
    teamGroupId: post.teamGroupId || teamBackfillByPost.get(post.id) || null,
    commentsDisabled: post.commentsDisabled,
    createdAt: post.createdAt,
    author: post.author,
    likeCount: post._count.likes,
    commentCount: post._count.comments,
    pendingRequestCount: post._count.playRequests,
    isLiked: post.likes.length > 0,
    likeId: post.likes[0]?.id || null,
    myPlayRequest: post.playRequests.find((r) => r.userId === userId) || null,
    approvedPlayerNames: (post.authorId === userId || post.playRequests.some((r) => r.userId === userId && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.playRequests.filter((r) => r.status === "APPROVED").map((r) => r.user.name)
      : [],
    manualPlayers: (post.authorId === userId || post.playRequests.some((r) => r.userId === userId && (r.status === "APPROVED" || r.status === "PENDING")))
      ? post.manualPlayers
      : "",
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
    // Friend groups are private — only the post author sees which friend group(s) the post was sent to
    friendGroups: post.authorId === userId
      ? post.postFriendGroups.map((pfg) => ({ id: pfg.friendGroup.id, name: pfg.friendGroup.name }))
      : [],
    event: post.event
      ? {
          id: post.event.id,
          title: post.event.title,
          eventType: post.event.eventType,
          startDate: post.event.startDate,
          endDate: post.event.endDate,
          venueName: post.event.venueName,
          maxParticipants: post.event.maxParticipants,
          ntrpMin: post.event.ntrpMin,
          ntrpMax: post.event.ntrpMax,
          coverImageUrl: post.event.coverImageUrl,
          registeredCount: post.event._count.participants,
        }
      : null,
  }));

  return NextResponse.json(formatted);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { content, mediaUrl, mediaType, photoUrls, groupIds, friendGroupIds, postType, playDate, playTime, playDuration, courtLocation, gameType, playersNeeded, courtBooked, skillMin, skillMax, isBroadcast, broadcastRadiusMi } = await request.json();

  // Broadcast validation: only valid on find_players, requires author lat/lng,
  // radius must be one of the allowed values. Rate-limited per user/day.
  // NOTE: today we snapshot the author's home coords; a future iteration could
  // geocode courtLocation and prefer those coords for "near this court" matching.
  let broadcastLat: number | null = null;
  let broadcastLng: number | null = null;
  const wantsBroadcast = isBroadcast === true;
  let normalizedRadius = 0;
  if (wantsBroadcast) {
    if (postType !== "find_players") {
      return NextResponse.json({ error: "Broadcast is only available on Find Players posts" }, { status: 400 });
    }
    if ((Array.isArray(groupIds) && groupIds.length > 0) ||
        (Array.isArray(friendGroupIds) && friendGroupIds.length > 0)) {
      return NextResponse.json(
        { error: "Broadcasts can't be limited to specific groups" },
        { status: 400 }
      );
    }
    const r = Number(broadcastRadiusMi);
    if (!BROADCAST_RADII.includes(r as typeof BROADCAST_RADII[number])) {
      return NextResponse.json({ error: "Invalid broadcast radius" }, { status: 400 });
    }
    normalizedRadius = r;

    const author = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { latitude: true, longitude: true },
    });
    if (author?.latitude == null || author?.longitude == null) {
      return NextResponse.json(
        { error: "Set your location in your profile before broadcasting" },
        { status: 400 }
      );
    }
    broadcastLat = author.latitude;
    broadcastLng = author.longitude;

    const rl = rateLimit(`broadcast:${session.user.id}`, 5, DAY_MS);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Daily broadcast limit reached. Try again tomorrow." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }
  }

  // Normalize photoUrls (cap at 9). Falls back to legacy single-image
  // mediaUrl/mediaType pair when photoUrls isn't provided.
  let normalizedPhotoUrls: string[] = [];
  if (Array.isArray(photoUrls)) {
    normalizedPhotoUrls = photoUrls
      .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      .slice(0, 9);
  }

  // For multi-photo posts, set legacy mediaUrl to the first photo so older
  // consumers (and the chat preview, post grid thumbnail, etc.) still work.
  let resolvedMediaUrl = mediaUrl || "";
  let resolvedMediaType = mediaType || "";
  if (normalizedPhotoUrls.length > 0) {
    resolvedMediaUrl = normalizedPhotoUrls[0];
    resolvedMediaType = "image";
  }

  if (!content?.trim() && !resolvedMediaUrl && postType !== "find_players") {
    return NextResponse.json({ error: "Post must have text or media" }, { status: 400 });
  }

  const post = await prisma.post.create({
    data: {
      content: (content || "").trim(),
      mediaUrl: resolvedMediaUrl,
      mediaType: resolvedMediaType,
      postType: postType || "regular",
      playDate: playDate || "",
      playTime: playTime || "",
      playDuration: Number(playDuration) || 90,
      courtLocation: courtLocation || "",
      gameType: gameType || "",
      playersNeeded: playersNeeded || 0,
      courtBooked: courtBooked || false,
      skillMin: typeof skillMin === "number" ? skillMin : null,
      skillMax: typeof skillMax === "number" ? skillMax : null,
      isBroadcast: wantsBroadcast,
      broadcastRadiusMi: normalizedRadius,
      broadcastLat,
      broadcastLng,
      authorId: session.user.id,
      // Multi-photo: persist the full array (including the first one duplicated
      // in mediaUrl) so the read path can return them in order.
      photos:
        normalizedPhotoUrls.length > 1
          ? {
              create: normalizedPhotoUrls.map((url, i) => ({ url, order: i })),
            }
          : undefined,
      postGroups:
        groupIds && groupIds.length > 0
          ? {
              create: groupIds.map((groupId: string) => ({ groupId })),
            }
          : undefined,
      postFriendGroups:
        friendGroupIds && friendGroupIds.length > 0
          ? {
              create: friendGroupIds.map((friendGroupId: string) => ({ friendGroupId })),
            }
          : undefined,
    },
    include: {
      author: { select: { id: true, name: true, profileImageUrl: true } },
      _count: { select: { likes: true } },
      postGroups: {
        include: {
          group: { select: { id: true, name: true } },
        },
      },
      postFriendGroups: {
        include: {
          friendGroup: { select: { id: true, name: true } },
        },
      },
      photos: {
        orderBy: { order: "asc" },
        select: { url: true },
      },
    },
  });

  return NextResponse.json({
    id: post.id,
    content: post.content,
    mediaUrl: post.mediaUrl,
    mediaType: post.mediaType,
    photoUrls:
      post.photos.length > 0
        ? post.photos.map((p) => p.url)
        : post.mediaType === "image" && post.mediaUrl
        ? [post.mediaUrl]
        : [],
    postType: post.postType,
    playDate: post.playDate,
    playTime: post.playTime,
    playDuration: post.playDuration,
    courtLocation: post.courtLocation,
    gameType: post.gameType,
    playersNeeded: post.playersNeeded,
    skillMin: post.skillMin,
    skillMax: post.skillMax,
    playersConfirmed: 0,
    courtBooked: post.courtBooked,
    isComplete: false,
    isBroadcast: post.isBroadcast,
    broadcastRadiusMi: post.broadcastRadiusMi,
    distanceMiles: null,
    teamGroupId: null,
    createdAt: post.createdAt,
    author: post.author,
    likeCount: 0,
    commentCount: 0,
    pendingRequestCount: 0,
    isLiked: false,
    likeId: null,
    myPlayRequest: null,
    groups: post.postGroups.map((pg) => ({ id: pg.group.id, name: pg.group.name })),
    friendGroups: post.postFriendGroups.map((pfg) => ({ id: pfg.friendGroup.id, name: pfg.friendGroup.name })),
  });
}
