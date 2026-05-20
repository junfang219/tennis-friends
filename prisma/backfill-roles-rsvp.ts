/**
 * Backfill for PR #1 (schema-first migration):
 *   1. GroupMember.role — OWNER for the row matching Group.ownerId, MEMBER otherwise.
 *   2. MatchAvailability.status — legacy vocab → playing/maybe/not_playing.
 *   3. PracticeAvailability.status — legacy vocab → playing/not_playing.
 *
 * Idempotent: re-running it is a no-op for already-migrated rows.
 *
 * Run with: npx ts-node prisma/backfill-roles-rsvp.ts
 */
import { PrismaClient } from "@prisma/client";
import { ROLE } from "../src/lib/groupRoles";
import {
  RSVP,
  normalizeMatchStatus,
  normalizePracticeStatus,
} from "../src/lib/rsvpStatus";

const prisma = new PrismaClient();

async function backfillRoles() {
  const groups = await prisma.group.findMany({ select: { id: true, ownerId: true } });
  let promoted = 0;
  let defaulted = 0;

  for (const g of groups) {
    // Owner row → OWNER (only if not already)
    const ownerUpdate = await prisma.groupMember.updateMany({
      where: { groupId: g.id, userId: g.ownerId, role: { not: ROLE.OWNER } },
      data: { role: ROLE.OWNER },
    });
    promoted += ownerUpdate.count;

    // Anyone else with empty role → MEMBER (schema default is already MEMBER,
    // but legacy rows pre-migration will have role="" from null coercion).
    const memberUpdate = await prisma.groupMember.updateMany({
      where: { groupId: g.id, userId: { not: g.ownerId }, role: "" },
      data: { role: ROLE.MEMBER },
    });
    defaulted += memberUpdate.count;
  }

  console.log(`Roles backfilled: ${promoted} owners promoted, ${defaulted} members defaulted.`);
}

async function backfillMatchRsvp() {
  const rows = await prisma.matchAvailability.findMany({
    select: { id: true, status: true },
  });
  let changed = 0;
  for (const r of rows) {
    const next = normalizeMatchStatus(r.status);
    // Skip rows that are already canonical OR that map to NO_RESPONSE (we
    // don't store NO_RESPONSE — the absence of a row already encodes it).
    if (next === r.status || next === RSVP.NO_RESPONSE) continue;
    await prisma.matchAvailability.update({
      where: { id: r.id },
      data: { status: next },
    });
    changed += 1;
  }
  console.log(`MatchAvailability rows updated: ${changed} / ${rows.length}.`);
}

async function backfillPracticeRsvp() {
  const rows = await prisma.practiceAvailability.findMany({
    select: { id: true, status: true },
  });
  let changed = 0;
  for (const r of rows) {
    const next = normalizePracticeStatus(r.status);
    if (next === r.status || next === RSVP.NO_RESPONSE) continue;
    await prisma.practiceAvailability.update({
      where: { id: r.id },
      data: { status: next },
    });
    changed += 1;
  }
  console.log(`PracticeAvailability rows updated: ${changed} / ${rows.length}.`);
}

async function main() {
  console.log("Starting PR#1 backfill (roles + RSVP vocab)…");
  await backfillRoles();
  await backfillMatchRsvp();
  await backfillPracticeRsvp();
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
