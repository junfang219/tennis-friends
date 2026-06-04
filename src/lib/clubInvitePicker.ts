// Pure helper for the club invite picker (Friends page) — which of my
// friends can still be invited to a club. Excludes current members and
// anyone with a pending invitation. Pure module: no React, no Supabase.

export interface PickerFriend {
  user: { id: string };
}

export function filterInvitableFriends<T extends PickerFriend>(
  friends: T[],
  memberIds: Iterable<string>,
  pendingInviteeIds: Iterable<string>
): T[] {
  const members = new Set(memberIds);
  const pending = new Set(pendingInviteeIds);
  return friends.filter((f) => !members.has(f.user.id) && !pending.has(f.user.id));
}
