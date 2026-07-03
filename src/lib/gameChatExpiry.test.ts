import { describe, expect, it } from "vitest";
import { GAME_CHAT_GRACE_MS, isGameChatVisible } from "./gameChatExpiry";

// A fixed "now" so the tests don't depend on the wall clock.
const NOW = new Date("2026-07-02T12:00:00Z").getTime();
const iso = (ms: number) => new Date(ms).toISOString();

describe("isGameChatVisible", () => {
  it("keeps non-game chats (null session_end_at) forever", () => {
    expect(isGameChatVisible(null, NOW)).toBe(true);
  });

  it("keeps a game chat whose game is still in the future", () => {
    expect(isGameChatVisible(iso(NOW + 60 * 60 * 1000), NOW)).toBe(true);
  });

  it("keeps a game chat within the 3-day grace window", () => {
    // Ended 2 days ago — still inside the 3-day grace period.
    expect(isGameChatVisible(iso(NOW - 2 * 24 * 60 * 60 * 1000), NOW)).toBe(true);
  });

  it("keeps a game chat exactly at the grace boundary", () => {
    expect(isGameChatVisible(iso(NOW - GAME_CHAT_GRACE_MS), NOW)).toBe(true);
  });

  it("hides a game chat once past the 3-day grace window", () => {
    // Ended 3 days + 1 minute ago.
    const endedMs = NOW - GAME_CHAT_GRACE_MS - 60 * 1000;
    expect(isGameChatVisible(iso(endedMs), NOW)).toBe(false);
  });

  it("hides a chat created on Jun 13 (the reported stale case)", () => {
    // Game on Jun 13; by Jul 2 it is weeks past the grace window.
    expect(isGameChatVisible("2026-06-13T20:00:00Z", NOW)).toBe(false);
  });

  it("does not hide chats with an unparseable timestamp", () => {
    expect(isGameChatVisible("not-a-date", NOW)).toBe(true);
  });
});
