#!/usr/bin/env node
// Visible end-to-end demo of the crowd-sourced court availability feature.
// Runs Chrome headed + slow-mo so a human can watch:
//   1. Login as Roger
//   2. Land on feed; arrival-detection hook polls
//   3. Geolocation override + bookings poll → popup appears
//   4. Click "Yes, there are open courts"
//   5. Navigate to /courts/<id> → "Recent activity" block visible
//   6. Navigate to /courts?selected=<id> → map summary card chip visible
//
// Usage:
//   node scripts/demo-arrival.mjs          # public_park (Alki Playfield)
//   COURT=school node scripts/demo-arrival.mjs
//   COURT=college node scripts/demo-arrival.mjs

import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer";

const BASE = process.env.BASE_URL || "http://localhost:3457";
const EMAIL = "roger@tennis.com";
const PASSWORD = "password123";

const VENUES = {
  public_park: { courtId: "tf-1",  name: "Alki Playfield Tennis Courts",       lat: 47.579254265031544, lng: -122.40770459175111 },
  school:      { courtId: "tf-82", name: "Bellevue High School Tennis Courts", lat: 47.60317547039083,  lng: -122.19725847244264 },
  college:     { courtId: "tf-77", name: "Seattle University Tennis Courts",   lat: 47.60779781813984,  lng: -122.31487870216371 },
};
const VENUE = VENUES[process.env.COURT || "public_park"];
const START_PAGE = process.env.START_PAGE || "/";

const prisma = new PrismaClient();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function pad2(n) { return n.toString().padStart(2, "0"); }
function ymd(d)  { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function hm(d)   { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

async function seedPost(userId) {
  await prisma.courtAvailabilityReport.deleteMany({ where: { userId } });
  await prisma.post.deleteMany({
    where: { authorId: userId, postType: "find_players", courtLocation: VENUE.name },
  });
  const startsAt = new Date(Date.now() + 10 * 60 * 1000);
  return prisma.post.create({
    data: {
      content: "DEMO — looking for hitting partner",
      postType: "find_players",
      playDate: ymd(startsAt),
      playTime: hm(startsAt),
      playDuration: 90,
      courtLocation: VENUE.name,
      gameType: "singles",
      playersNeeded: 1,
      authorId: userId,
    },
  });
}

async function login(page) {
  const csrfRes = await page.goto(`${BASE}/api/auth/csrf`, { waitUntil: "domcontentloaded" });
  const csrfToken = JSON.parse(await csrfRes.text()).csrfToken;
  await page.evaluate(
    async (base, email, password, csrfToken) => {
      const body = new URLSearchParams({
        email, password, csrfToken,
        callbackUrl: `${base}/`, json: "true",
      });
      await fetch(`${base}/api/auth/callback/credentials?json=true`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });
    },
    BASE, EMAIL, PASSWORD, csrfToken
  );
}

async function step(page, label) {
  console.log(`\n>>> ${label}`);
  // Reposition the OS-level Chrome window via an internal CDP call would
  // require more setup; instead we just briefly title-flash the page.
  await page.evaluate((t) => {
    document.title = `▶ ${t}`;
  }, label);
}

async function main() {
  const roger = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  const post = await seedPost(roger.id);
  console.log(`Seeded post ${post.id} for ${VENUE.name} starting at ${post.playTime}`);

  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 60,
    defaultViewport: null,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=900,1000",
      "--window-position=80,40",
    ],
  });

  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(BASE, ["geolocation"]);

    const [page] = await browser.pages();

    await step(page, "1) Logging in as Roger");
    await login(page);
    await pause(800);

    await step(page, `2) Loading ${START_PAGE} (no location yet)`);
    await page.goto(`${BASE}${START_PAGE}`, { waitUntil: "domcontentloaded" });
    await pause(2500);

    await step(page, `3) Spoofing geolocation to ${VENUE.name}`);
    const cdp = await page.target().createCDPSession();
    await cdp.send("Emulation.setGeolocationOverride", {
      latitude: VENUE.lat,
      longitude: VENUE.lng,
      accuracy: 10,
    });
    // Clear any prior prompt flag so the popup is allowed to fire again.
    await page.evaluate(() => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("arrivalPrompted:")) localStorage.removeItem(k);
      }
    });

    await step(page, "4) Waiting for arrival popup (hook polls every ~90s)");
    await page.waitForFunction(
      () => {
        const h = document.getElementById("arrival-report-title");
        return h && (h.textContent || "").includes("Are there empty courts");
      },
      { timeout: 150_000, polling: 1000 }
    );
    console.log("   popup is up — pausing 3s so you can read it");
    await pause(3000);

    await step(page, "5) Clicking 'Yes, there are open courts'");
    const buttons = await page.$$("button");
    for (const b of buttons) {
      const t = await page.evaluate((el) => el.textContent || "", b);
      if (t.includes("Yes, there are open courts")) {
        await b.click();
        break;
      }
    }
    await pause(2500);

    await step(page, `6) Opening detail page /courts/${VENUE.courtId}`);
    await page.goto(`${BASE}/courts/${VENUE.courtId}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("h2, h3"))
        .some((h) => (h.textContent || "").trim() === "Recent activity"),
      { timeout: 20_000, polling: 500 }
    );
    console.log("   'Recent activity' block rendered — pausing 4s");
    await pause(4000);

    await step(page, `7) Opening map summary card /courts?selected=${VENUE.courtId}`);
    await page.goto(`${BASE}/courts?selected=${VENUE.courtId}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => {
        const all = Array.from(document.querySelectorAll("div, span"));
        return all.some((el) => {
          const t = (el.textContent || "").trim();
          return t.includes("reported empty courts") && t.includes("last at");
        });
      },
      { timeout: 20_000, polling: 500 }
    );
    console.log("   map summary card chip visible — pausing 6s");
    await pause(6000);

    console.log("\nDone. Closing in 3s — press Ctrl+C to keep the window open.");
    await pause(3000);
  } finally {
    await browser.close();
    await prisma.courtAvailabilityReport.deleteMany({ where: { userId: roger.id } });
    await prisma.post.deleteMany({
      where: { authorId: roger.id, postType: "find_players", courtLocation: VENUE.name },
    });
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error("FAILED:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
