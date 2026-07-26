import { describe, expect, it } from "vitest";
import { parseDailyAvailability, toProxyPath } from "./activenet";

describe("toProxyPath", () => {
  it("strips the ActiveNet origin so the URL is served by the /seattle proxy", () => {
    expect(
      toProxyPath(
        "https://anc.apm.activecommunities.com/seattle/reservation/search/detail/281?locale=en-US"
      )
    ).toBe("/seattle/reservation/search/detail/281?locale=en-US");
    expect(
      toProxyPath("https://apm.activecommunities.com/seattle/reservation/search")
    ).toBe("/seattle/reservation/search");
  });

  it("leaves an already-relative or non-ActiveNet URL unchanged", () => {
    expect(toProxyPath("/seattle/signin")).toBe("/seattle/signin");
    expect(toProxyPath("https://example.com/x")).toBe("https://example.com/x");
  });
});

// Captured verbatim from a live call to
//   GET /seattle/rest/reservation/resource/availability/daily/279
//        ?start_date=2026-06-12&end_date=2026-06-13
// (resource 279 = Amy Yee Outdoor Tennis Court 01). Trimmed to two days.
const REAL_PAYLOAD = {
  headers: { response_code: "0000", response_message: "Successful" },
  body: {
    details: {
      resource_id: 279,
      reservation_unit: 1,
      daily_details: [
        {
          date: "2026-06-12",
          status: 0,
          times: [
            { id: 0, start_time: "07:00:00", end_time: "09:30:00", available: true, is_cross_day: false },
            { id: 0, start_time: "10:45:00", end_time: "12:00:00", available: true, is_cross_day: false },
            { id: 0, start_time: "13:30:00", end_time: "17:00:00", available: true, is_cross_day: false },
          ],
          holiday_desc: null,
        },
        {
          date: "2026-06-13",
          status: 0,
          times: [
            { id: 0, start_time: "07:00:00", end_time: "08:00:00", available: true, is_cross_day: false },
          ],
          holiday_desc: null,
        },
      ],
    },
  },
};

describe("parseDailyAvailability", () => {
  it("groups slots by day in order", () => {
    const days = parseDailyAvailability(REAL_PAYLOAD);
    expect(days.map((d) => d.date)).toEqual(["2026-06-12", "2026-06-13"]);
    expect(days[0].slots).toHaveLength(3);
    expect(days[1].slots).toHaveLength(1);
  });

  it("maps snake_case fields to a normalized slot shape", () => {
    const [first] = parseDailyAvailability(REAL_PAYLOAD)[0].slots;
    expect(first).toEqual({
      date: "2026-06-12",
      startTime: "07:00:00",
      endTime: "09:30:00",
      available: true,
    });
  });

  it("treats only available === false as unavailable", () => {
    const days = parseDailyAvailability({
      body: {
        details: {
          daily_details: [
            {
              date: "2026-06-12",
              times: [
                { start_time: "07:00:00", end_time: "08:00:00", available: false },
                { start_time: "08:00:00", end_time: "09:00:00" }, // missing → available
              ],
            },
          ],
        },
      },
    });
    expect(days[0].slots.map((s) => s.available)).toEqual([false, true]);
  });

  it("drops entries with no start/end time", () => {
    const days = parseDailyAvailability({
      body: {
        details: {
          daily_details: [
            {
              date: "2026-06-12",
              times: [
                { start_time: "", end_time: "", available: true },
                { start_time: "09:00:00", end_time: "10:00:00", available: true },
              ],
            },
          ],
        },
      },
    });
    expect(days[0].slots).toHaveLength(1);
  });

  it("returns an empty array for an empty / shapeless body", () => {
    expect(parseDailyAvailability({})).toEqual([]);
    expect(parseDailyAvailability({ body: { details: {} } })).toEqual([]);
  });

  it("carries the per-day status code through", () => {
    const days = parseDailyAvailability(REAL_PAYLOAD);
    expect(days.map((d) => d.status)).toEqual([0, 0]);
  });

  it("surfaces a same-day status (7) even with no times", () => {
    const days = parseDailyAvailability({
      body: { details: { daily_details: [{ date: "2026-06-12", status: 7, times: [] }] } },
    });
    expect(days[0].status).toBe(7);
    expect(days[0].slots).toEqual([]);
  });

  it("uses null status when the field is absent", () => {
    const days = parseDailyAvailability({
      body: { details: { daily_details: [{ date: "2026-06-12", times: [] }] } },
    });
    expect(days[0].status).toBeNull();
  });
});
