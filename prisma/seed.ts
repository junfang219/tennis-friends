import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Clean existing data
  await prisma.like.deleteMany();
  await prisma.post.deleteMany();
  await prisma.friendship.deleteMany();
  await prisma.user.deleteMany();

  const password = await bcrypt.hash("password123", 12);

  const users = await Promise.all([
    prisma.user.create({
      data: {
        name: "Serena Williams",
        email: "serena@tennis.com",
        passwordHash: password,
        bio: "23 Grand Slam titles and counting. Love inspiring the next generation of players!",
        skillLevel: "professional",
        favoriteSurface: "hard",
        profileImageUrl: "",
      },
    }),
    prisma.user.create({
      data: {
        name: "Roger Federer",
        email: "roger@tennis.com",
        passwordHash: password,
        bio: "Retired but still hitting forehands. Tennis is a lifetime sport.",
        skillLevel: "professional",
        favoriteSurface: "grass",
        profileImageUrl: "",
      },
    }),
    prisma.user.create({
      data: {
        name: "Maria Chen",
        email: "maria@tennis.com",
        passwordHash: password,
        bio: "Weekend warrior looking for hitting partners in the Bay Area. 3.5 NTRP and improving!",
        skillLevel: "intermediate",
        favoriteSurface: "hard",
        profileImageUrl: "",
      },
    }),
    prisma.user.create({
      data: {
        name: "James Park",
        email: "james@tennis.com",
        passwordHash: password,
        bio: "Just picked up tennis 6 months ago and I'm hooked. Clay court enthusiast.",
        skillLevel: "beginner",
        favoriteSurface: "clay",
        profileImageUrl: "",
      },
    }),
    prisma.user.create({
      data: {
        name: "Sofia Rodriguez",
        email: "sofia@tennis.com",
        passwordHash: password,
        bio: "Former college player, now coaching and playing doubles leagues. Always up for a match!",
        skillLevel: "advanced",
        favoriteSurface: "clay",
        profileImageUrl: "",
      },
    }),
    prisma.user.create({
      data: {
        name: "Alex Thompson",
        email: "alex@tennis.com",
        passwordHash: password,
        bio: "Serve and volley specialist. Indoor courts are my happy place.",
        skillLevel: "advanced",
        favoriteSurface: "indoor",
        profileImageUrl: "",
      },
    }),
  ]);

  const [serena, roger, maria, james, sofia, alex] = users;

  // Create some friendships
  await Promise.all([
    prisma.friendship.create({
      data: { requesterId: serena.id, addresseeId: roger.id, status: "ACCEPTED" },
    }),
    prisma.friendship.create({
      data: { requesterId: maria.id, addresseeId: sofia.id, status: "ACCEPTED" },
    }),
    prisma.friendship.create({
      data: { requesterId: james.id, addresseeId: maria.id, status: "ACCEPTED" },
    }),
    prisma.friendship.create({
      data: { requesterId: alex.id, addresseeId: roger.id, status: "ACCEPTED" },
    }),
    prisma.friendship.create({
      data: { requesterId: sofia.id, addresseeId: serena.id, status: "PENDING" },
    }),
  ]);

  // Create some posts
  await Promise.all([
    prisma.post.create({
      data: {
        content: "Just had an amazing rally session this morning! Nothing beats the sound of a clean backhand down the line.",
        authorId: serena.id,
        createdAt: new Date(Date.now() - 1000 * 60 * 30),
      },
    }),
    prisma.post.create({
      data: {
        content: "Beautiful day at the grass courts. The ball skids so differently here — you have to stay low and keep your feet moving!",
        authorId: roger.id,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
      },
    }),
    prisma.post.create({
      data: {
        content: "Finally broke through 3.5 NTRP! All those extra practice hours are paying off. Looking for a 4.0 hitting partner to keep pushing my game.",
        authorId: maria.id,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5),
      },
    }),
    prisma.post.create({
      data: {
        content: "Day 180 of my tennis journey. My serve is still a work in progress but my forehand is getting consistent. This sport is addictive!",
        authorId: james.id,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8),
      },
    }),
    prisma.post.create({
      data: {
        content: "Coaching tip of the day: Focus on your split step timing. A good split step is the foundation of great court coverage.",
        authorId: sofia.id,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12),
      },
    }),
    prisma.post.create({
      data: {
        content: "Indoor season is here! Who else prefers the consistent bounce and no-wind conditions? Let's set up some matches.",
        authorId: alex.id,
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
    }),
  ]);

  console.log("Seed data created successfully!");
  console.log("Demo accounts (all use password: password123):");
  users.forEach((u) => console.log(`  ${u.name} — ${u.email}`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
