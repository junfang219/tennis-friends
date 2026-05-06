export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 30;

export function parseTags(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map((t) => t.trim()).filter(Boolean);
}

export function serializeTags(tags: string[]): string {
  return tags
    .map((t) => t.trim().replace(/,/g, ""))
    .filter((t) => t.length > 0 && t.length <= MAX_TAG_LENGTH)
    .slice(0, MAX_TAGS)
    .join(",");
}
