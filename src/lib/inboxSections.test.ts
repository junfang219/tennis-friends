import { describe, expect, it } from "vitest";
import { buildInboxSections } from "./inboxSections";
import type { InboxItem } from "@/components/ConversationRow";

// Minimal factory helpers — only the fields buildInboxSections reads matter.
function group(
  id: string,
  kind: "session" | "friendGroup",
  sessionEndAt: string | null = null,
): InboxItem {
  return {
    type: "group",
    id,
    title: id,
    href: `/chat/group/${id}`,
    unreadCount: 0,
    muted: false,
    pinnedAt: null,
    kind,
    sessionEndAt,
    participants: [],
    lastMessage: null,
  };
}

function team(id: string): InboxItem {
  return {
    type: "team",
    id,
    title: id,
    href: `/groups/${id}/chat`,
    unreadCount: 0,
    muted: false,
    pinnedAt: null,
    participants: [],
    lastMessage: null,
  };
}

function direct(id: string): InboxItem {
  return {
    type: "direct",
    id,
    title: id,
    href: `/chat/${id}`,
    unreadCount: 0,
    muted: false,
    pinnedAt: null,
    avatarUser: { id, name: id, profileImageUrl: "" },
    lastMessage: null,
  };
}

describe("buildInboxSections", () => {
  it("shows friend group chats together in inbox order", () => {
    const items = [
      group("g1", "session"),
      group("group1", "friendGroup"),
      group("group2", "friendGroup"),
      team("t1"),
      direct("d1"),
    ];
    const sections = buildInboxSections(items);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s.items.map((i) => i.id)]));

    expect(byKey.games).toEqual(["g1"]);
    expect(byKey.friendGroups).toEqual(["group1", "group2"]);
    expect(byKey.teams).toEqual(["t1"]);
    expect(byKey.direct).toEqual(["d1"]);
    expect(sections.find((section) => section.key === "friendGroups")?.header).toBe("Friend Groups");
  });

  it("omits the games section when only friend groups have chats", () => {
    const sections = buildInboxSections([group("group2", "friendGroup"), group("group1", "friendGroup")]);
    expect(sections.map((s) => s.key)).toEqual(["friendGroups"]);
  });

  it("orders sections and drops empty ones", () => {
    const sections = buildInboxSections([
      direct("d1"),
      group("group1", "friendGroup"),
      group("g1", "session"),
    ]);
    expect(sections.map((s) => s.key)).toEqual(["games", "friendGroups", "direct"]);
  });

  it("sorts games by soonest session end, null end last", () => {
    const sections = buildInboxSections([
      group("late", "session", "2026-06-20T00:00:00Z"),
      group("noEnd", "session", null),
      group("soon", "session", "2026-06-12T00:00:00Z"),
    ]);
    const games = sections.find((s) => s.key === "games");
    expect(games?.items.map((i) => i.id)).toEqual(["soon", "late", "noEnd"]);
  });

  it("returns no sections for an empty inbox", () => {
    expect(buildInboxSections([])).toEqual([]);
  });
});
