#!/usr/bin/env node
// Verifies the crowd-sourced court availability flow across multiple courts:
//   - For each "should trigger" venue: seeds a find_players Post, logs in,
//     spoofs Chrome to the venue, waits for the popup, clicks Yes, then
//     asserts the report row was written + the "Recent activity" block renders.
//   - For each "should NOT trigger" venue (ineligible category): seeds the
//     same kind of post, runs the same flow, asserts the popup never appears
//     within a shorter timeout.

import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer";

const BASE = process.env.BASE_URL || "http://localhost:3457";
const EMAIL = "roger@tennis.com";
const PASSWORD = "password123";

const CASES = [
  {
    label: "school",
    expectPopup: true,
    courtId: "tf-82",
    name: "Bellevue High School Tennis Courts",
    lat: 47.60317547039083,
    lng: -122.19725847244264,
  },
  {
    label: "college",
    expectPopup: true,
    courtId: "tf-77",
    name: "Seattle University Tennis Courts",
    lat: 47.60779781813984,
    lng: -122.31487870216371,
  },
  {
    label: "public_park",
    expectPopup: true,
    courtId: "tf-1",
    name: "Alki Playfield Tennis Courts",
    lat: 47.579254265031544,
    lng: -122.40770459175111,
  },
  {
    label: "private_club (NEGATIVE)",
    expectPopup: false,
    courtId: "tf-58",
    name: "Seattle Tennis Club",
    lat: 47.6270093,
    lng: -122.2811794,
  },
];

const prisma = new PrismaClient();

function pad2(n) {
  return n.toString().padStart(2, "0");
}
function ymd(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function hm(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

async function resetUserState(userId) {
  await prisma.courtAvailabilityReport.deleteMany({ where: { userId } });
  await prisma.post.deleteMany({
    where: { authorId: userId, postType: "find_players" },
  });
}

async function seedPost(userId, venue) {
  const startsAt = new Date(Date.now() + 10 * 60 * 1000);
  return prisma.post.create({
    data: {
      content: `Verification post for ${venue.label}`,
      postType: "find_players",
      playDate: ymd(startsAt),
      playTime: hm(startsAt),
      playDuration: 90,
      courtLocation: venue.name,
      gameType: "singles",
      playersNeeded: 1,
      authorId: userId,
    },
  });
}

async function login(page) {
  const csrfRes = await page.goto(`${BASE}/api/auth/csrf`, { waitUntil: "domcontentloaded" });
  const csrfBody = JSON.parse(await csrfRes.text());
  const csrfToken = csrfBody.csrfToken;
  const result = await page.evaluate(
    async (base, email, password, csrfToken) => {
      const body = new URLSearchParams({
        email, password, csrfToken,
        callbackUrl: `${base}/`, json: "true",
      });
      const r = await fetch(`${base}/api/auth/callback/credentials?json=true`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        credentials: "include",
      });
      return { status: r.status };
    },
    BASE, EMAIL, PASSWORD, csrfToken
  );
  if (result.status >= 400) throw new Error(`login failed: HTTP ${result.status}`);
}

async function overrideGeolocation(page, venue) {
  const client = await page.target().createCDPSession();
  await client.send("Emulation.setGeolocationOverride", {
    latitude: venue.lat,
    longitude: venue.lng,
    accuracy: 10,
  });
}

async function waitForArrivalModal(page, timeoutMs) {
  return page.waitForFunction(
    () => {
      const h = document.getElementById("arrival-report-title");
      return h && h.textContent && h.textContent.includes("Are there empty courts");
    },
    { timeout: timeoutMs, polling: 1000 }
  );
}

async function modalSubtitle(page) {
  return page.evaluate(() => {
    const h = document.getElementById("arrival-report-title");
    return h?.parentElement?.querySelector("p")?.textContent || null;
  });
}

async function clickYes(page) {
  const buttons = await page.$$("button");
  for (const b of buttons) {
    const txt = await page.evaluate((el) => el.textContent || "", b);
    if (txt.includes("Yes, there are open courts")) {
      await b.click();
      return true;
    }
  }
  return false;
}

async function clearPromptFlags(page) {
  await page.evaluate(() => {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("arrivalPrompted:")) localStorage.removeItem(k);
    }
  });
}

async function runCase(browser, userId, venue) {
  const page = await browser.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [browser err] ${m.text()}`);
  });

  console.log(`\n=== ${venue.label} : ${venue.name} (${venue.courtId}) — expectPopup=${venue.expectPopup}`);
  const post = await seedPost(userId, venue);
  console.log(`  seeded post ${post.id} @ ${post.playDate} ${post.playTime}`);

  await login(page);
  await overrideGeolocation(page, venue);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await clearPromptFlags(page);

  if (venue.expectPopup) {
    await waitForArrivalModal(page, 150_000);
    const subtitle = await modalSubtitle(page);
    if (!subtitle || !subtitle.includes(venue.name)) {
      throw new Error(`popup subtitle mismatch: got "${subtitle}", expected to contain "${venue.name}"`);
    }
    console.log(`  ✓ popup appeared with subtitle: ${subtitle}`);
    await page.screenshot({ path: `/tmp/arrival-${venue.courtId}.png` });

    const clicked = await clickYes(page);
    if (!clicked) throw new Error("'Yes' button not found");
    let row = null;
    for (let i = 0; i < 20; i++) {
      row = await prisma.courtAvailabilityReport.findFirst({
        where: { userId, courtId: venue.courtId },
        orderBy: { reportedAt: "desc" },
      });
      if (row) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!row) throw new Error("no report row written");
    if (!row.hasEmpty || row.postId !== post.id) {
      throw new Error(`row fields wrong: hasEmpty=${row.hasEmpty}, postId=${row.postId}`);
    }
    console.log(`  ✓ DB row created (id=${row.id})`);

    await page.goto(`${BASE}/courts/${venue.courtId}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => {
        const headers = Array.from(document.querySelectorAll("h2, h3"));
        return headers.some((h) => (h.textContent || "").trim() === "Recent activity");
      },
      { timeout: 20_000, polling: 500 }
    );
    console.log(`  ✓ "Recent activity" block rendered on detail page`);
    await page.screenshot({ path: `/tmp/detail-${venue.courtId}.png`, fullPage: true });
  } else {
    let appeared = false;
    try {
      await waitForArrivalModal(page, 30_000);
      appeared = true;
    } catch {
      appeared = false;
    }
    if (appeared) throw new Error("popup appeared but should NOT have (ineligible category)");
    const row = await prisma.courtAvailabilityReport.findFirst({
      where: { userId, courtId: venue.courtId },
    });
    if (row) throw new Error("a report row was written but should NOT have been");
    console.log(`  ✓ popup did NOT appear (private_club correctly suppressed)`);
  }

  await page.close();
}

async function main() {
  const roger = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  await resetUserState(roger.id);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let failures = 0;
  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(BASE, ["geolocation"]);

    for (const venue of CASES) {
      await resetUserState(roger.id);
      try {
        await runCase(browser, roger.id, venue);
      } catch (err) {
        failures++;
        console.log(`  ✗ FAILED: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
    await resetUserState(roger.id);
    await prisma.$disconnect();
  }

  console.log(`\n=== ${CASES.length - failures}/${CASES.length} cases passed`);
  if (failures > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error("FATAL:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
