export const EVENT_TYPE_META: Record<
  string,
  { label: string; emoji: string; bg: string; text: string }
> = {
  tournament: {
    label: "Tournament",
    emoji: "🏆",
    bg: "bg-clay/10",
    text: "text-clay",
  },
  round_robin: {
    label: "Round Robin",
    emoji: "🔁",
    bg: "bg-court-green/10",
    text: "text-court-green",
  },
  mixer: {
    label: "Social Mixer",
    emoji: "🤝",
    bg: "bg-ball-yellow/20",
    text: "text-court-green",
  },
  clinic: {
    label: "Clinic",
    emoji: "🎾",
    bg: "bg-court-green-soft/15",
    text: "text-court-green-soft",
  },
};
