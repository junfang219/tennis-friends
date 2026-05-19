import { prisma } from "./prisma";

/**
 * Ensure a backing Group exists for an Event so chat/feed work for free.
 * Idempotent — returns the existing groupId if one is already linked.
 * The Group owner is the event organizer; members are kept in sync with
 * registered (non-waitlisted, non-withdrawn) EventParticipant rows.
 */
export async function ensureEventGroup(eventId: string): Promise<string | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, ownerId: true, groupId: true, eventType: true },
  });
  if (!event) return null;
  if (event.groupId) return event.groupId;

  const group = await prisma.group.create({
    data: {
      name: event.title,
      ownerId: event.ownerId,
      members: { create: [{ userId: event.ownerId }] },
    },
  });

  await prisma.groupMessage.create({
    data: {
      groupId: group.id,
      senderId: event.ownerId,
      content: welcomeMessage(event.title, event.eventType),
    },
  });

  await prisma.event.update({
    where: { id: event.id },
    data: { groupId: group.id },
  });

  return group.id;
}

/**
 * Sync the backing Group's membership with the event's registered participants.
 * Call after signup / withdrawal / waitlist-promotion. Idempotent.
 */
export async function syncEventGroupMembers(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { groupId: true, ownerId: true },
  });
  if (!event?.groupId) return;

  const registered = await prisma.eventParticipant.findMany({
    where: { eventId, status: "registered" },
    select: { userId: true },
  });
  const desired = new Set<string>([event.ownerId, ...registered.map((p) => p.userId)]);

  const existing = await prisma.groupMember.findMany({
    where: { groupId: event.groupId },
    select: { userId: true },
  });
  const have = new Set(existing.map((m) => m.userId));

  const toAdd = [...desired].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !desired.has(id) && id !== event.ownerId);

  if (toAdd.length > 0) {
    await prisma.groupMember.createMany({
      data: toAdd.map((userId) => ({ groupId: event.groupId!, userId })),
    });
  }
  if (toRemove.length > 0) {
    await prisma.groupMember.deleteMany({
      where: { groupId: event.groupId, userId: { in: toRemove } },
    });
  }
}

function welcomeMessage(title: string, type: string): string {
  const flair: Record<string, string> = {
    tournament: "🏆 Tournament time — bring your A game!",
    round_robin: "🔁 Round-robin — you'll play everyone, good luck!",
    ladder: "🪜 Ladder open — climb the ranks by challenging up.",
    mixer: "🤝 Social mixer — partners rotate, just have fun.",
    clinic: "🎾 Clinic — show up ready to learn.",
    custom: "✨ See you there!",
  };
  const tag = flair[type] ?? "🎾 Let's play!";
  return `Welcome to ${title}! ${tag}`;
}
