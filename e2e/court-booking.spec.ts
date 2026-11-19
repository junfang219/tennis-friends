import { expect, test } from "@playwright/test";
import type { CourtAvailability } from "../src/app/api/courts/availability/route";

test.use({ viewport: { width: 375, height: 812 }, timezoneId: "America/Los_Angeles" });

const date = "2026-11-20";
const openWindow = { date, startTime: "07:00:00", endTime: "09:00:00", available: true };
const reservableCourt: CourtAvailability = {
  resourceId: 365,
  courtName: "Volunteer Park Court 01 - Upper",
  reservable: true,
  error: true,
  slots: [],
};
const walkOnCourt: CourtAvailability = {
  resourceId: 366,
  courtName: "Volunteer Park Court 02 - Upper",
  reservable: false,
  error: false,
  slots: [openWindow],
};

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-18T22:00:00Z"));
});

test("preserves My bookings as the sign-in destination from Courts", async ({ page }) => {
  await page.goto("/courts");
  const courtsNav = page.getByRole("navigation", { name: "Courts section" });
  await courtsNav.getByRole("link", { name: "My bookings" }).click();

  await expect(page).toHaveURL((url) =>
    url.pathname === "/login" && url.searchParams.get("next") === "/bookings"
  );
});

test("offers direct booking and keeps loaded walk-on windows during a partial failure", async ({ page }) => {
  await page.route("**/api/courts/availability?*", (route) =>
    route.fulfill({ json: { courts: [reservableCourt, walkOnCourt], dayStatus: 0, source: "live" } })
  );
  await page.goto(`/courts/tf-42?date=${date}`);

  const directBooking = page.getByRole("link", { name: "Book directly on Seattle Parks" });
  await expect(directBooking).toHaveAttribute("href", /^https:\/\/anc\.apm\.activecommunities\.com\/seattle\/reservation\/search\?/);
  await expect(page.getByText("7–9a", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Start time" })).toHaveCount(0);
});

test("keeps the time picker when another reservable court is available", async ({ page }) => {
  const loadedCourt: CourtAvailability = {
    resourceId: 363,
    courtName: "Volunteer Park Court 03 - Lower",
    reservable: true,
    error: false,
    slots: [openWindow],
  };
  await page.route("**/api/courts/availability?*", (route) =>
    route.fulfill({ json: { courts: [reservableCourt, loadedCourt], dayStatus: 0, source: "live" } })
  );
  await page.goto(`/courts/tf-42?date=${date}`);

  await page.getByRole("combobox", { name: "Start time" }).selectOption("420");
  await expect(page.getByRole("link", { name: /Book on Seattle Parks/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Book directly on Seattle Parks" })).toHaveCount(0);
});
