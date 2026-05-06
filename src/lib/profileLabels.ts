export const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  professional: "Professional",
};

export const AGE_LABELS: Record<string, string> = {
  under_18: "Under 18",
  "18_29": "18–29",
  "30_49": "30–49",
  "50_plus": "50+",
};

export const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  non_binary: "Non-binary",
  prefer_not_to_say: "Prefer not to say",
};

export type RatingFields = {
  ratingSystem?: string | null;
  ntrpRating?: number | null;
  utrRating?: number | null;
  skillLevel?: string | null;
};

export function formatRating(p: RatingFields): string {
  if (p.ratingSystem === "ntrp" && p.ntrpRating != null) return `NTRP ${p.ntrpRating.toFixed(1)}`;
  if (p.ratingSystem === "utr" && p.utrRating != null) return `UTR ${p.utrRating.toFixed(2)}`;
  if (p.ratingSystem === "self" && p.skillLevel) return SKILL_LABELS[p.skillLevel] || p.skillLevel;
  return "";
}
