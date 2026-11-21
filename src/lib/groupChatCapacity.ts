export const GROUP_CHAT_MEMBER_LIMIT = 200;

export function isGroupChatCapacityError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "P2001";
}
