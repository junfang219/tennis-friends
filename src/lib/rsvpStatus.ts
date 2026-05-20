// Unified RSVP vocabulary across MatchAvailability and PracticeAvailability.
// "no_response" is implicit (no row) and never written; included here so UI code
// has a single union to switch on.
export const RSVP = {
  PLAYING: "playing",
  MAYBE: "maybe",
  NOT_PLAYING: "not_playing",
  NO_RESPONSE: "no_response",
} as const;

export type RsvpStatus = (typeof RSVP)[keyof typeof RSVP];

// Legacy → unified mappings used by the backfill script and by any client code
// that still posts the old values during the transition window.
export function normalizeMatchStatus(raw: string): RsvpStatus {
  switch (raw) {
    case "available":
      return RSVP.PLAYING;
    case "if_needed":
    case "not_sure":
      return RSVP.MAYBE;
    case "not_available":
      return RSVP.NOT_PLAYING;
    case RSVP.PLAYING:
    case RSVP.MAYBE:
    case RSVP.NOT_PLAYING:
      return raw as RsvpStatus;
    default:
      return RSVP.NO_RESPONSE;
  }
}

export function normalizePracticeStatus(raw: string): RsvpStatus {
  switch (raw) {
    case "im_in":
      return RSVP.PLAYING;
    case "not_available":
      return RSVP.NOT_PLAYING;
    case RSVP.PLAYING:
    case RSVP.MAYBE:
    case RSVP.NOT_PLAYING:
      return raw as RsvpStatus;
    default:
      return RSVP.NO_RESPONSE;
  }
}

export const RSVP_LABEL: Record<RsvpStatus, string> = {
  playing: "Playing",
  maybe: "Maybe",
  not_playing: "Not playing",
  no_response: "No response",
};
