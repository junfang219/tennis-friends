// Game ("Game confirmed") chats auto-expire from the inbox a few days after the
// game ends, so the chat list doesn't accumulate stale threads. The inbox UI
// advertises this ("Auto-removes 3 days after the game"), and this is where the
// rule is actually enforced.
//
// A chat is a game chat when it carries a session_end_at (the game's end
// timestamp, written by the chat-creation trigger). DM and friend-group chats
// have session_end_at = null and never expire here. We key off session_end_at
// rather than post_id because chats.post_id is ON DELETE SET NULL — a game chat
// whose post was later deleted keeps session_end_at and must still expire.

export const GAME_CHAT_GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Whether a chat should still appear in the inbox. Returns true for every chat
 * except a game chat whose game ended more than GAME_CHAT_GRACE_MS ago.
 *
 * @param sessionEndAt game end timestamp (ISO), or null for non-game chats
 * @param now          current time in ms (injectable for testing)
 */
export function isGameChatVisible(
  sessionEndAt: string | null,
  now: number = Date.now()
): boolean {
  if (!sessionEndAt) return true;
  const endMs = new Date(sessionEndAt).getTime();
  if (Number.isNaN(endMs)) return true; // unparseable → don't hide it
  return now <= endMs + GAME_CHAT_GRACE_MS;
}
