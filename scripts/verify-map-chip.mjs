#!/usr/bin/env node
// Verifies that the "X players reported empty courts" amber chip shows on the
// map summary card (CourtSummaryCard) after a report is submitted. Seeds a
// fresh report directly, then opens /courts?selected=tf-1 so the card pops up.

import { PrismaClient } from "@prisma/client";
import puppeteer from "puppeteer";

const BASE = process.env.BASE_URL || "http://localhost:3457";
const EMAIL = "roger@tennis.com";
const PASSWORD = "password123";

const CASES = [
  { courtId: "tf-1",  name: "Alki Playfield Tennis Courts",       lat: 47.579254265031544, lng: -122.40770459175111 },
  { courtId: "tf-82", name: "Bellevue High School Tennis Courts", lat: 47.60317547039083,  lng: -122.19725847244264 },
  { courtId: "tf-77", name: "Seattle University Tennis Courts",   lat: 47.60779781813984,  lng: -122.31487870216371 },
];

const prisma = new PrismaClient();

async function seedReports(userId, courtId, n) {
  await prisma.courtAvailabilityReport.deleteMany({ where: { courtId } });
  for (let i = 0; i < n; i++) {
    await prisma.courtAvailabilityReport.create({
      data: { courtId, userId, hasEmpty: true, postId: null },
    });
  }
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

async function runCase(browser, userId, venue) {
  console.log(`\n=== ${venue.name} (${venue.courtId})`);
  await seedReports(userId, venue.courtId, 3);
  console.log("  seeded 3 empty-court reports");

  const page = await browser.newPage();
  await page.setViewport({ width: 414, height: 800 });
  await login(page);
  await page.goto(`${BASE}/courts?selected=${venue.courtId}`, { waitUntil: "domcontentloaded" });

  // The map fetches the court detail, pans, then opens the summary card.
  // Wait for the card's name to appear.
  await page.waitForFunction(
    (name) => {
      const headers = Array.from(document.querySelectorAll("h3"));
      return headers.some((h) => (h.textContent || "").trim() === name);
    },
    { timeout: 20_000, polling: 500 },
    venue.name
  );

  // Then wait for the chip to render (the recent-reports fetch is in-card).
  const chipText = await page.waitForFunction(
    () => {
      const all = Array.from(document.querySelectorAll("div, span"));
      for (const el of all) {
        const t = (el.textContent || "").trim();
        if (t.includes("reported empty courts") && t.includes("last at")) {
          return t.slice(0, 200);
        }
      }
      return null;
    },
    { timeout: 15_000, polling: 500 }
  );
  const text = await chipText.jsonValue();
  console.log(`  ✓ map chip: "${text}"`);

  await page.screenshot({ path: `/Users/junfang/Desktop/arrival-screenshots/map-${venue.courtId}.png` });
  await page.close();
}

async function main() {
  const roger = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const context = browser.defaultBrowserContext();
    await context.overridePermissions(BASE, ["geolocation"]);
    for (const venue of CASES) {
      try {
        await runCase(browser, roger.id, venue);
      } catch (err) {
        console.log(`  ✗ FAILED: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
    for (const v of CASES) {
      await prisma.courtAvailabilityReport.deleteMany({ where: { courtId: v.courtId } });
    }
    await prisma.$disconnect();
  }
}

main().catch(async (e) => {
  console.error("FATAL:", e.message);
  await prisma.$disconnect();
  process.exit(1);
});
