export function filterNonmemberFriends<T extends { user: { id: string } }>(
  friends: T[],
  memberIds: Iterable<string>,
): T[] {
  const members = new Set(memberIds);
  return friends.filter(({ user }) => !members.has(user.id));
}
