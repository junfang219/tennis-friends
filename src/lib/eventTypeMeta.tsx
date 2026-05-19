export type CompetitiveSurface = "bracket" | "standings" | "rotations" | "none";

export type EventTypeMeta = {
  label: string;
  emoji: string;
  bg: string;
  text: string;
  competitiveSurface: CompetitiveSurface;
  supportsMatches: boolean;
};

export const EVENT_TYPE_META: Record<string, EventTypeMeta> = {
  tournament: {
    label: "Tournament",
    emoji: "🏆",
    bg: "bg-clay/10",
    text: "text-clay",
    competitiveSurface: "bracket",
    supportsMatches: true,
  },
  round_robin: {
    label: "Round Robin",
    emoji: "🔁",
    bg: "bg-court-green/10",
    text: "text-court-green",
    competitiveSurface: "standings",
    supportsMatches: true,
  },
  ladder: {
    label: "Ladder",
    emoji: "🪜",
    bg: "bg-indigo-50",
    text: "text-indigo-700",
    competitiveSurface: "standings",
    supportsMatches: true,
  },
  mixer: {
    label: "Social Mixer",
    emoji: "🤝",
    bg: "bg-ball-yellow/20",
    text: "text-court-green",
    competitiveSurface: "rotations",
    supportsMatches: true,
  },
  clinic: {
    label: "Clinic",
    emoji: "🎾",
    bg: "bg-court-green-soft/15",
    text: "text-court-green-soft",
    competitiveSurface: "none",
    supportsMatches: false,
  },
  custom: {
    label: "Custom",
    emoji: "✨",
    bg: "bg-gray-100",
    text: "text-gray-700",
    competitiveSurface: "none",
    supportsMatches: false,
  },
};
