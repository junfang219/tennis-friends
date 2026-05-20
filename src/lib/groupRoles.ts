// Role values stored as strings on GroupMember.role (SQLite has no enum support).
// Hierarchy (highest privilege first): OWNER > MANAGER > CAPTAIN > MEMBER.
export const ROLE = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  CAPTAIN: "CAPTAIN",
  MEMBER: "MEMBER",
} as const;

export type GroupRole = (typeof ROLE)[keyof typeof ROLE];

const RANK: Record<GroupRole, number> = {
  OWNER: 4,
  MANAGER: 3,
  CAPTAIN: 2,
  MEMBER: 1,
};

export function isAtLeast(role: string, min: GroupRole): boolean {
  const r = (RANK as Record<string, number>)[role] ?? 0;
  return r >= RANK[min];
}

// Default member-type list applied when a team hasn't customized its Group.memberTypes.
// Stored on Group.memberTypes as JSON, so the API can read defaults if the column is "[]".
export const DEFAULT_MEMBER_TYPES = [
  "Full-time",
  "Sub",
  "Coach",
  "Parent",
  "Guest",
] as const;

export function parseMemberTypes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed.length > 0 ? parsed : [...DEFAULT_MEMBER_TYPES];
    }
  } catch {
    // fall through
  }
  return [...DEFAULT_MEMBER_TYPES];
}
