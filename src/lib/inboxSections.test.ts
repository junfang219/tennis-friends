import { describe, expect, it } from "vitest";
import { buildInboxSections } from "./inboxSections";
import type { InboxItem } from "@/components/ConversationRow";

// Minimal factory helpers — only the fields buildInboxSections reads matter.
function group(
  id: string,
  kind: "session" | "club" | "circle",
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
  it("splits clubs and circles into their own sections, separate from games", () => {
    const items = [
      group("g1", "session"),
      group("club1", "club"),
      group("circle1", "circle"),
      team("t1"),
      direct("d1"),
    ];
    const sections = buildInboxSections(items);
    const byKey = Object.fromEntries(sections.map((s) => [s.key, s.items.map((i) => i.id)]));

    expect(byKey.games).toEqual(["g1"]);
    expect(byKey.clubs).toEqual(["club1"]);
    expect(byKey.circles).toEqual(["circle1"]);
    expect(byKey.teams).toEqual(["t1"]);
    expect(byKey.direct).toEqual(["d1"]);
  });

  it("does NOT lump club/circle chats under the games section (the bug)", () => {
    const sections = buildInboxSections([group("club1", "club"), group("circle1", "circle")]);
    const games = sections.find((s) => s.key === "games");
    expect(games).toBeUndefined();
    expect(sections.map((s) => s.key)).toEqual(["clubs", "circles"]);
  });

  it("orders sections games → teams → clubs → circles → direct and drops empties", () => {
    const sections = buildInboxSections([
      direct("d1"),
      group("circle1", "circle"),
      group("g1", "session"),
    ]);
    // Empty teams/clubs sections are omitted; present ones keep canonical order.
    expect(sections.map((s) => s.key)).toEqual(["games", "circles", "direct"]);
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
