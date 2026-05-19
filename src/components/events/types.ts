// Shared types for Phase 2 event components.

export type PlayerMini = {
  id: string;
  name: string;
  profileImageUrl: string;
  ntrpRating?: number | null;
};

export type EventMatchView = {
  id: string;
  eventId: string;
  player1Id: string;
  player2Id: string;
  player3Id: string | null;
  player4Id: string | null;
  round: number | null;
  bracketSlot: string;
  scheduledAt: string | null;
  courtAssign: string;
  score: string;
  winnerSide: number | null;
  reportedBy: string;
  confirmedBy: string;
  proposedBy: string;
  disputedAt: string | null;
  status:
    | "proposed"
    | "declined"
    | "scheduled"
    | "in_progress"
    | "completed"
    | "cancelled";
  player1: PlayerMini | null;
  player2: PlayerMini | null;
  player3?: PlayerMini | null;
  player4?: PlayerMini | null;
};

export type StandingsRowView = {
  userId: string;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  points: number;
  rank: number;
  user: PlayerMini | null;
};

export type BracketRound = {
  round: number;
  label: string;
  matches: EventMatchView[];
};

export type BracketView = {
  seeded: boolean;
  totalRounds: number;
  rounds: BracketRound[];
};
