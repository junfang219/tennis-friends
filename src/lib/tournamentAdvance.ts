import { prisma } from "./prisma";
import { postEventSystemMessage } from "./eventGroup";

// Pull a completed tournament match's winner into the next round's matching
// slot. Slots use "R<round>-<index>" naming and pair sequentially (slot 1 vs 2
// in round N → feeds slot 1 in round N+1). Creates the next-round match row if
// it doesn't exist yet, or fills in the second player if it does.
export async function advanceTournamentWinner(
  eventId: string,
  matchId: string
): Promise<void> {
  const match = await prisma.eventMatch.findUnique({ where: { id: matchId } });
  if (!match || match.status !== "completed" || !match.winnerSide) return;
  if (!match.bracketSlot || !match.round) return;

  const winnerId = match.winnerSide === 1 ? match.player1Id : match.player2Id;
  if (!winnerId) return;

  const m = match.bracketSlot.match(/^R(\d+)-(\d+)$/);
  if (!m) return;
  const round = parseInt(m[1], 10);
  const slot = parseInt(m[2], 10);
  const nextRound = round + 1;
  const nextSlot = Math.ceil(slot / 2);
  const nextSlotName = `R${nextRound}-${nextSlot}`;
  const isUpperSeed = slot % 2 === 1; // upper pair feeds player1, lower feeds player2

  // Did this match have a sibling? If not, this was the final.
  const sibling = await prisma.eventMatch.findFirst({
    where: {
      eventId,
      bracketSlot: `R${round}-${slot % 2 === 1 ? slot + 1 : slot - 1}`,
    },
    select: { id: true, status: true, winnerSide: true, player1Id: true, player2Id: true },
  });
  const wasFinal = !sibling && slot === 1;
  if (wasFinal) {
    const winner = await prisma.user.findUnique({
      where: { id: winnerId },
      select: { name: true },
    });
    if (winner?.name) {
      await postEventSystemMessage(eventId, `🏆 Champion: ${winner.name}!`);
    }
    return;
  }

  const next = await prisma.eventMatch.findFirst({
    where: { eventId, bracketSlot: nextSlotName },
  });

  if (next) {
    await prisma.eventMatch.update({
      where: { id: next.id },
      data: isUpperSeed
        ? { player1Id: winnerId }
        : { player2Id: winnerId },
    });
  } else {
    // First of the two feeders to complete → create the row with one player.
    await prisma.eventMatch.create({
      data: {
        eventId,
        bracketSlot: nextSlotName,
        round: nextRound,
        player1Id: isUpperSeed ? winnerId : "",
        player2Id: isUpperSeed ? "" : winnerId,
        status: "scheduled",
      },
    });
  }
}
