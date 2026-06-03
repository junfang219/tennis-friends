import type { RankedWindow } from "./availabilityPoll";
import type { SharePayload } from "./lfpShare";

// Pure formatter that turns a captain-selected set of ranked windows into the
// payload that nativeShare() takes. No DOM, no Capacitor, no React — fully
// unit-testable.
//
// Format goals (decisions locked with user):
// - Date + time only — no player counts, no names. Privacy-friendly if the
//   captain forwards the message outside the team.
// - One emoji-prefixed line per window, captain's selection order preserved.
// - NO link. The poll detail page requires team membership; embedding the
//   URL produced a confusing "You are not a member of this team" page for
//   anyone outside the team. Plain text travels everywhere and the recipient
//   has the actual times they need to reply.

export type BuildPollShareInput = {
  teamName: string;
  windows: RankedWindow[];
};

function formatDateLong(date: string): string {
  // Anchor at noon to dodge UTC-midnight day shifts on negative offsets.
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function buildPollShare(input: BuildPollShareInput): SharePayload {
  const teamLabel = input.teamName.trim() || "your team";
  const title = `Possible times — ${teamLabel}`;

  const lines: string[] = [];
  lines.push(`🎾 ${teamLabel} — possible times`);
  if (input.windows.length > 0) {
    lines.push("");
    for (const w of input.windows) {
      lines.push(`📅 ${formatDateLong(w.date)} · ${w.start}–${w.end}`);
    }
  }

  // Pass an empty url so the Web Share API / Capacitor Share don't append
  // anything past the plain text body.
  return { title, text: lines.join("\n"), url: "" };
}
