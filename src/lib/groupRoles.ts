// Pure team-role helpers. Roles are an INDEPENDENT set (not a hierarchy):
// a member can hold any combination of "manager" and "captain", or neither.
//   - manager → ADMIN  capabilities (roster, settings, invites, role assignment)
//   - captain → OPS     capabilities (matches, practices, availability,
//                                     announcements, files, albums)
// Ownership is separate (groups.owner_id) and ALWAYS grants both — so an owner
// needs no entry in their roles array. Mirrors the Postgres group_member_role
// enum + the can_admin_group / can_run_group capability functions.

export type TeamRole = "manager" | "captain";

export const TEAM_ROLES: { value: TeamRole; label: string }[] = [
  { value: "manager", label: "Manager" },
  { value: "captain", label: "Captain" },
];

const VALID_ROLES = new Set<TeamRole>(["manager", "captain"]);

// Parse a member's roles from the jsonb/array shape Supabase returns (or a
// JSON-encoded string), keeping only recognized roles. Unknown values are
// dropped so a stale role can't linger as a phantom capability.
export function parseRoles(raw: string | unknown[] | null | undefined): TeamRole[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? safeJsonArray(raw)
      : [];
  return arr.filter((r): r is TeamRole => typeof r === "string" && VALID_ROLES.has(r as TeamRole));
}

function safeJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type Capability = { isOwner: boolean; roles: TeamRole[] };

// ADMIN: owner or anyone holding the manager role.
export function canAdmin({ isOwner, roles }: Capability): boolean {
  return isOwner || roles.includes("manager");
}

// OPS: owner or anyone holding the captain role.
export function canCaptain({ isOwner, roles }: Capability): boolean {
  return isOwner || roles.includes("captain");
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
