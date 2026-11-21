import { describe, expect, it } from "vitest";
import {
  SEARCH_YEARS,
  DEFAULT_YEAR,
  isValidYear,
} from "./searchOptions";

describe("SEARCH_YEARS", () => {
  it("includes next season's year (registration opens before the calendar year)", () => {
    const nextYear = String(new Date().getFullYear() + 1);
    expect(SEARCH_YEARS).toContain(nextYear);
  });

  it("spans from next year down to 2014, newest first", () => {
    expect(SEARCH_YEARS[0]).toBe(String(new Date().getFullYear() + 1));
    expect(SEARCH_YEARS[SEARCH_YEARS.length - 1]).toBe("2014");
    const asNumbers = SEARCH_YEARS.map(Number);
    for (let i = 1; i < asNumbers.length; i++) {
      expect(asNumbers[i]).toBe(asNumbers[i - 1] - 1);
    }
  });

  it("defaults to the current year, which is a valid option", () => {
    expect(DEFAULT_YEAR).toBe(String(new Date().getFullYear()));
    expect(isValidYear(DEFAULT_YEAR)).toBe(true);
  });

  it("accepts next year and rejects out-of-range years", () => {
    expect(isValidYear(String(new Date().getFullYear() + 1))).toBe(true);
    expect(isValidYear("2013")).toBe(false);
    expect(isValidYear(String(new Date().getFullYear() + 2))).toBe(false);
  });
});
