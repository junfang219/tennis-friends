import { NextResponse } from "next/server";
import { auth } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { splitEqualCents, dollarsString } from "@/lib/payment";

async function verifyParticipant(userId: string, chatId: string) {
  const participant = await prisma.chatParticipant.findUnique({
    where: { chatId_userId: { chatId, userId } },
  });
  return !!participant;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: chatId } = await params;
  const userId = session.user.id;

  if (!(await verifyParticipant(userId, chatId))) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const amountCents = Number(body.amountCents);
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 200) : "";

  if (!Number.isFinite(amountCents) || amountCents <= 0 || !Number.isInteger(amountCents)) {
    return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  }

  const participants = await prisma.chatParticipant.findMany({
    where: { chatId },
    select: { userId: true },
  });

  // Pull manual (off-platform) player names — they count toward the per-head split
  // but don't get an ExpenseShare row (the payer collects from them in person).
  const chatRecord = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { manualPlayerNames: true },
  });
  const guestNames = (chatRecord?.manualPlayerNames || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const guestCount = guestNames.length;

  if (participants.length + guestCount < 2) {
    return NextResponse.json({ error: "Need at least 2 players" }, { status: 400 });
  }

  const others = participants.map((p) => p.userId).filter((id) => id !== userId);
  if (others.length === 0 && guestCount === 0) {
    return NextResponse.json({ error: "No one to split with" }, { status: 400 });
  }

  // Split the full amount across all N players (registered + guests). Payer's
  // own share is implicit (not stored). Distribute remainder cents across the
  // first few non-payer slots so shares sum exactly to amountCents.
  const N = participants.length + guestCount;
  const allShares = splitEqualCents(amountCents, N);
  // Slot 0 is the payer's own share. The remaining N-1 shares cover non-payer
  // registered users plus guests. We only persist rows for registered users.
  const nonPayerShares = allShares.slice(1);
  const registeredOwerShares = nonPayerShares.slice(0, others.length);
  const guestShareSample = nonPayerShares[others.length] ?? nonPayerShares[0] ?? 0;

  const payer = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  });

  const guestShareValues = guestNames.map((_, i) =>
    nonPayerShares[others.length + i] ?? 0
  );

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        chatId,
        payerId: userId,
        amountCents,
        description,
        shares: {
          create: others.map((otherId, i) => ({
            userId: otherId,
            amountCents: registeredOwerShares[i],
          })),
        },
        guestShares: {
          create: guestNames.map((guestName, i) => ({
            guestName,
            amountCents: guestShareValues[i],
          })),
        },
      },
      include: {
        payer: { select: { id: true, name: true, profileImageUrl: true } },
        shares: true,
        guestShares: true,
      },
    });

    const payerName = payer?.name || "Someone";
    const perShareDollars = registeredOwerShares[0] ?? guestShareSample;
    const totalOwers = others.length + guestCount;
    const guestSuffix = guestCount > 0
      ? ` (incl. ${guestCount} guest${guestCount === 1 ? "" : "s"} — collect in person)`
      : "";
    const owesLine = totalOwers === 1
      ? `The other player owes ${payerName} $${dollarsString(perShareDollars)}${guestSuffix}.`
      : `Each of the other ${totalOwers} players owes ${payerName} $${dollarsString(perShareDollars)}${guestSuffix}.`;
    const summary = description
      ? `💵 ${payerName} paid $${dollarsString(amountCents)} for ${description}. ${owesLine}`
      : `💵 ${payerName} paid $${dollarsString(amountCents)}. ${owesLine}`;

    await tx.chatMessage.create({
      data: { chatId, senderId: userId, content: summary },
    });

    return created;
  });

  return NextResponse.json(expense);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: chatId } = await params;
  const userId = session.user.id;

  if (!(await verifyParticipant(userId, chatId))) {
    return NextResponse.json({ error: "Not a participant" }, { status: 403 });
  }

  const expenses = await prisma.expense.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    include: {
      payer: { select: { id: true, name: true, profileImageUrl: true } },
      shares: {
        include: {
          user: {
            select: {
              id: true,
              name: true,
              profileImageUrl: true,
              venmoHandle: true,
              paypalHandle: true,
              cashappHandle: true,
              zelleHandle: true,
            },
          },
        },
      },
      guestShares: true,
    },
  });

  // Pull payment handles for everyone in the chat (we may net-owe them).
  const participants = await prisma.chatParticipant.findMany({
    where: { chatId },
    select: {
      user: {
        select: {
          id: true,
          name: true,
          profileImageUrl: true,
          venmoHandle: true,
          paypalHandle: true,
          cashappHandle: true,
          zelleHandle: true,
        },
      },
    },
  });
  const userIndex = new Map(participants.map((p) => [p.user.id, p.user]));

  // netCents > 0 → otherId owes me; netCents < 0 → I owe otherId.
  const net = new Map<string, number>();
  for (const exp of expenses) {
    if (exp.payerId === userId) {
      // Others owe me their unsettled shares.
      for (const s of exp.shares) {
        if (!s.settledAt) net.set(s.userId, (net.get(s.userId) || 0) + s.amountCents);
      }
    } else {
      // I might owe payer my share.
      const myShare = exp.shares.find((s) => s.userId === userId);
      if (myShare && !myShare.settledAt) {
        net.set(exp.payerId, (net.get(exp.payerId) || 0) - myShare.amountCents);
      }
    }
  }

  const balances = Array.from(net.entries())
    .filter(([, cents]) => cents !== 0)
    .map(([otherId, netCents]) => {
      const u = userIndex.get(otherId);
      return {
        otherId,
        otherName: u?.name || "Unknown",
        otherImage: u?.profileImageUrl || "",
        netCents,
        paymentHandles: {
          venmoHandle: u?.venmoHandle || null,
          paypalHandle: u?.paypalHandle || null,
          cashappHandle: u?.cashappHandle || null,
          zelleHandle: u?.zelleHandle || null,
        },
      };
    });

  // Guest balances: only the payer of an expense sees how much each guest
  // still owes them (guests pay in person; nothing happens app-side).
  type GuestAgg = { guestName: string; amountCents: number; openShareIds: string[] };
  const guestMap = new Map<string, GuestAgg>();
  for (const exp of expenses) {
    if (exp.payerId !== userId) continue;
    for (const gs of exp.guestShares) {
      if (gs.settledAt) continue;
      const existing = guestMap.get(gs.guestName) || {
        guestName: gs.guestName,
        amountCents: 0,
        openShareIds: [],
      };
      existing.amountCents += gs.amountCents;
      existing.openShareIds.push(gs.id);
      guestMap.set(gs.guestName, existing);
    }
  }
  const guestBalances = Array.from(guestMap.values()).filter((g) => g.amountCents !== 0);

  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      venmoHandle: true,
      paypalHandle: true,
      cashappHandle: true,
      zelleHandle: true,
    },
  });

  const chatMeta = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { manualPlayerNames: true },
  });
  const guestNames = (chatMeta?.manualPlayerNames || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return NextResponse.json({
    expenses,
    balances,
    guestBalances,
    guestNames,
    myHandles: {
      venmoHandle: me?.venmoHandle || null,
      paypalHandle: me?.paypalHandle || null,
      cashappHandle: me?.cashappHandle || null,
      zelleHandle: me?.zelleHandle || null,
    },
  });
}
