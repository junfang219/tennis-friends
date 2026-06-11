// Buckets inbox items into the ordered, labeled sections the Messages list
// renders (mobile /chat page and the desktop ConversationSidebar). Centralized
// so both surfaces categorize chats identically — game sessions, team chats,
// clubs, circles, and direct messages each get their own section with a
// matching accent color (see ConversationRow for the per-kind row styling).

import type { InboxItem } from "@/components/ConversationRow";

export type InboxSectionKey = "games" | "teams" | "clubs" | "circles" | "direct";

export interface InboxSection {
  key: InboxSectionKey;
  header: string;
  /** Optional caption shown beside the header (e.g. retention note). */
  caption?: string;
  /** Tailwind text-color class for the header, matching the row accent. */
  headerClass: string;
  items: InboxItem[];
}

function sectionKeyFor(item: InboxItem): InboxSectionKey {
  if (item.type === "team") return "teams";
  if (item.type === "group") {
    if (item.kind === "club") return "clubs";
    if (item.kind === "circle") return "circles";
    return "games"; // session/game chats
  }
  return "direct";
}

// Render order + per-section presentation. Games lead (time-sensitive), then
// the standing communities, then 1:1 DMs.
const SECTION_META: Omit<InboxSection, "items">[] = [
  {
    key: "games",
    header: "Upcoming games",
    caption: "Auto-removes 3 days after the game",
    headerClass: "text-court-green",
  },
  { key: "teams", header: "Team chats", headerClass: "text-clay" },
  { key: "clubs", header: "Clubs", headerClass: "text-violet-600" },
  { key: "circles", header: "Circles", headerClass: "text-blue-600" },
  { key: "direct", header: "Direct messages", headerClass: "text-gray-500" },
];

export function buildInboxSections(items: InboxItem[]): InboxSection[] {
  const buckets = new Map<InboxSectionKey, InboxItem[]>();
  for (const item of items) {
    const key = sectionKeyFor(item);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  // Game sessions sort by soonest game end (null end last); every other
  // section keeps the loader's order (pins first, then recency).
  const games = buckets.get("games");
  if (games) {
    games.sort((a, b) => {
      const aEnd =
        a.type === "group" && a.sessionEndAt ? new Date(a.sessionEndAt).getTime() : Infinity;
      const bEnd =
        b.type === "group" && b.sessionEndAt ? new Date(b.sessionEndAt).getTime() : Infinity;
      return aEnd - bEnd;
    });
  }

  return SECTION_META.map((meta) => ({ ...meta, items: buckets.get(meta.key) ?? [] })).filter(
    (section) => section.items.length > 0,
  );
}
