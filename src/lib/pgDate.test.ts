import { describe, expect, it } from "vitest";
import { pgToIso, pgToDate } from "./pgDate";

describe("pgToIso", () => {
  it("normalizes the PostgREST space-separator format with a bare +00 offset", () => {
    expect(pgToIso("2026-05-21 18:23:35.739572+00")).toBe(
      "2026-05-21T18:23:35.739572+00:00"
    );
  });

  it("normalizes a +HH offset without minutes", () => {
    expect(pgToIso("2026-05-21 12:00:00-07")).toBe(
      "2026-05-21T12:00:00-07:00"
    );
  });

  it("passes through a Z-terminated ISO string unchanged", () => {
    expect(pgToIso("2026-05-21T18:23:35.000Z")).toBe(
      "2026-05-21T18:23:35.000Z"
    );
  });

  it("passes through a properly offset ISO string unchanged", () => {
    expect(pgToIso("2026-05-21T18:23:35+00:00")).toBe(
      "2026-05-21T18:23:35+00:00"
    );
  });

  it("returns empty string for empty input (no NaN traps)", () => {
    expect(pgToIso("")).toBe("");
  });

  it("leaves a bare date string alone (no trailing-offset mangling)", () => {
    // Regression: an earlier impl rewrote the day '-01' as if it were a tz
    // offset and produced '2026-06-01:00'. Guard with a date-only check.
    expect(pgToIso("2026-06-01")).toBe("2026-06-01");
    expect(pgToIso("2026-12-31")).toBe("2026-12-31");
  });
});

describe("pgToDate", () => {
  it("produces a real Date (not NaN) from the strict Postgres format that breaks iOS Safari", () => {
    const d = pgToDate("2026-05-21 18:23:35.739572+00");
    expect(Number.isNaN(d.getTime())).toBe(false);
    expect(d.toISOString()).toBe("2026-05-21T18:23:35.739Z");
  });

  it("ISO-already strings still parse cleanly", () => {
    const d = pgToDate("2026-05-21T18:23:35.000Z");
    expect(d.toISOString()).toBe("2026-05-21T18:23:35.000Z");
  });
});
