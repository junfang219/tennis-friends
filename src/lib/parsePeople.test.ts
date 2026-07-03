import { describe, it, expect } from "vitest";
import { parsePeopleLines } from "./parsePeople";

describe("parsePeopleLines", () => {
  it("parses bare names, trimming and dropping blanks", () => {
    expect(parsePeopleLines("  Sam Lee \n\n Jun Fang ")).toEqual([
      { name: "Sam Lee" },
      { name: "Jun Fang" },
    ]);
  });

  it("splits an email contact on the first comma", () => {
    expect(parsePeopleLines("Sam Lee, sam@x.com")).toEqual([
      { name: "Sam Lee", email: "sam@x.com" },
    ]);
  });

  it("treats a non-@ contact as a phone", () => {
    expect(parsePeopleLines("Sam Lee, +1 206 555 1212")).toEqual([
      { name: "Sam Lee", phone: "+1 206 555 1212" },
    ]);
  });

  it("ignores a trailing comma with no contact", () => {
    expect(parsePeopleLines("Sam Lee,")).toEqual([{ name: "Sam Lee" }]);
  });

  it("drops lines with an empty name", () => {
    expect(parsePeopleLines(", sam@x.com\nReal Name")).toEqual([
      { name: "Real Name" },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(parsePeopleLines("   \n  ")).toEqual([]);
  });
});
