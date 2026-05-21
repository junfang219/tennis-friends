// Pure role-hierarchy helpers. Database-touching helpers (getMemberRole,
// hasRole) were deleted when we burned down the Prisma layer — rebuild them
// against Supabase as needed.

// Hierarchy (highest privilege first): owner > manager > captain > member.
// Lowercase to match the Postgres group_role enum.
export const ROLE = {
  OWNER: "owner",
  MANAGER: "manager",
  CAPTAIN: "captain",
  MEMBER: "member",
} as const;

export type GroupRole = (typeof ROLE)[keyof typeof ROLE];

const RANK: Record<GroupRole, number> = {
  owner: 4,
  manager: 3,
  captain: 2,
  member: 1,
};

export function isAtLeast(role: string, min: GroupRole): boolean {
  const r = (RANK as Record<string, number>)[role] ?? 0;
  return r >= RANK[min];
}

// Default member-type list applied when a team hasn't customized its
// Group.memberTypes. Stored on groups.member_types as jsonb.
export const DEFAULT_MEMBER_TYPES = [
  "Full-time",
  "Sub",
  "Coach",
  "Parent",
  "Guest",
] as const;

export function parseMemberTypes(raw: string | unknown[]): string[] {
  // Postgres returns jsonb arrays as actual arrays in the JS client.
  if (Array.isArray(raw)) {
    const filtered = raw.filter((s): s is string => typeof s === "string");
    return filtered.length > 0 ? filtered : [...DEFAULT_MEMBER_TYPES];
  }
  if (typeof raw !== "string") return [...DEFAULT_MEMBER_TYPES];
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
