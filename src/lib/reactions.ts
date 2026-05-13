export const REACTIONS = [
  { key: "love", emoji: "❤️", label: "Love" },
  { key: "thumbsup", emoji: "👍", label: "Thumbs up" },
  { key: "haha", emoji: "😂", label: "Haha" },
  { key: "fire", emoji: "🔥", label: "Fire" },
  { key: "tennis", emoji: "🎾", label: "Tennis" },
  { key: "wow", emoji: "😮", label: "Wow" },
] as const;

export type ReactionKey = (typeof REACTIONS)[number]["key"];
export type MessageType = "DM" | "GROUP" | "CHAT";

export const REACTION_KEYS = REACTIONS.map((r) => r.key) as ReactionKey[];

export function emojiFor(key: string): string {
  return REACTIONS.find((r) => r.key === key)?.emoji ?? "";
}

export function isValidReactionKey(key: unknown): key is ReactionKey {
  return typeof key === "string" && REACTION_KEYS.includes(key as ReactionKey);
}

export function isValidMessageType(t: unknown): t is MessageType {
  return t === "DM" || t === "GROUP" || t === "CHAT";
}
