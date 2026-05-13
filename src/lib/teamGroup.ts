import { prisma } from "./prisma";

/**
 * Ensure a Team (Group) exists for a complete propose_team post.
 * Idempotent — returns the existing groupId if one is already linked on the
 * post. Otherwise creates a Group owned by the post author with all approved
 * players as members and stores the new groupId on Post.teamGroupId.
 *
 * For propose_team posts, courtLocation holds the user-entered team name.
 */
export async function ensureTeamGroup(postId: string): Promise<string | null> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      author: { select: { id: true, name: true } },
      playRequests: {
        where: { status: "APPROVED" },
        select: { userId: true },
      },
    },
  });
  if (!post) return null;
  if (post.postType !== "propose_team") return null;
  if (!post.isComplete) return null;
  if (post.teamGroupId) return post.teamGroupId;

  const memberIds = new Set<string>([post.authorId]);
  for (const r of post.playRequests) memberIds.add(r.userId);

  const teamName =
    (post.courtLocation && post.courtLocation.trim()) ||
    `${post.author.name}'s Team`;

  const group = await prisma.group.create({
    data: {
      name: teamName,
      ownerId: post.authorId,
      members: {
        create: Array.from(memberIds).map((userId) => ({ userId })),
      },
    },
  });

  await prisma.groupMessage.create({
    data: {
      groupId: group.id,
      senderId: post.authorId,
      content: `Welcome to ${group.name}! 🎾🏆 Team formed from a recruiting post — let's get on court! 💪`,
    },
  });

  await prisma.post.update({
    where: { id: post.id },
    data: { teamGroupId: group.id },
  });

  return group.id;
}
