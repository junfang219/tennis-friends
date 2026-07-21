# Community Teams: USTA Captain's Companion

Design doc for evolving TennisFriend teams (`groups`) into an operational hub
for real USTA league teams. TennisLink stays the system of record for
registration, official schedules, and official results; TennisFriend handles
what captains and players actually do week to week: roster, availability,
lineups, communication, and (later) scores and playoff eligibility.

Product decision (Jul 2026): **companion first** — we do not run our own
leagues. The existing events engine (`events`/`event_matches`) already covers
self-hosted ladders/tournaments; a self-hosted team-league engine can layer on
later if wanted.

## How USTA adult leagues actually work

Verified against the 2026 USTA National Regulations, PNW section regulations
(Feb + Apr 2026), TennisLink help docs, and the PNW/NW-Washington rescheduling
guidelines. Key sources:

- National regs + Q&A: https://www.usta.com/en/home/play/adult-tennis/programs/national/usta-league-resources.html
- PNW regulations: https://www.usta.com/content/dam/usta/sections/pacific-northwest/pdfs/play/league-regulations/pnw-league-regulations-april-2026.pdf
- PNW rescheduling: https://www.usta.com/content/dam/usta/sections/pacific-northwest/pdfs/play/nww-sww-nor-rescheduling-guidelines.pdf
- NTRP FAQ: https://www.usta.com/en/home/play/adult-tennis/programs/national/usta-ntrp-ratings-faqs.html

Findings that drove the design:

1. **A USTA team is season-scoped.** Team = age division (18&O, 40&O, 55&O,
   Mixed…) + NTRP level + flight + championship year, registered per season in
   TennisLink under a 10-digit team number; players join by entering that
   number. → League identity lives on `seasons`, not `groups`.
2. **Two rating schemes.** Straight individual levels (2.5–5.0) for 18&O/40&O;
   **combined pair-sum levels** (Mixed 6.0–10.0, 55&O 6.0–9.0, Combo x.5
   levels). Section variants (combo, tri-level, 18–39) are first-class.
3. **Lineup format varies by division, level, AND section/tier.** 18&O 3.0–4.5
   plays 2S+3D; 18&O 2.5/5.0 plays 1S+2D; PNW 40&O plays 1S+3D locally but
   1S+4D at national championships; 55&O and Mixed play 3D. Every "fixed
   format per division" claim failed adversarial verification. → Format is
   **per-season data** (`seasons.lineup_format` jsonb), never hardcoded.
4. **Eligibility rules at lineup time** (2026 national regs 1.04D): player
   NTRP ≤ team level; combined pairs: sum ≤ team level, gap ≤ 1.0. Roster
   floors: 8 (18&O 3.0–4.5), 5 (18&O 2.5W/5.0), 9 (40&O), 6 (55&O), 3M+3W
   (Mixed). PNW min courts to avoid a team default: 3-of-5, 3-of-4, 2-of-3
   (= majority). → Validators **warn, never block** — sections override
   national floors and rules drift yearly.
5. **Playoff eligibility is per-player match counts** on the same team: 2
   local matches to play Sectionals, 3 for Nationals, 4 for self-rated or
   appealed players (limited default credit). → Phase 3.
6. **NTRP ratings are typed and dated** (C/S/M/T/A/D codes, 2–3 year expiry,
   mid-season dynamic disqualification for self-rates). → A plain float is a
   simplification; typed ratings are phase 4.
7. **PNW rescheduling**: 3-week captain-to-captain grace window after schedule
   publication, then coordinator-only; changes emailed to the Local League
   Coordinator. → A lightweight proposed-date-change state is enough (phase 4).

Not verified by primary sources (kept out of scope / free-form): per-line
scoring format and team-point award mechanics, home-court reservation
responsibility, PNW registration fees.

## How match schedules actually form

Second research pass (verified against current regulations: PNW Apr 2026, NYC
Metro 2026, USTA Atlanta 2025, Lake Norman 2025, Austin/CATA 2024, USTA Flex
rules for Mid-Atlantic/NorCal/Colorado):

1. **The Local League Coordinator publishes the schedule in TennisLink** —
   teams/captains don't build it. Traditional entries carry date + time +
   venue + home designation; those slots originate from club-level pre-season
   court commitments (court booking is a captain/club responsibility, never
   the league's).
2. **Firmness is a spectrum, per league**: Metro NYC — firm, full reschedules
   prohibited; Atlanta/Lake Norman — mutual-agreement moves with a
   deterministic fallback (no agreement → original slot, or a pre-published
   makeup date); Austin/CATA — captains may convert any match into a
   "floating match" (TennisLink shows an irregular-date placeholder; playable
   any time before season end, even line-by-line); USTA Flex — schedule
   assigns only opponent + suggested week, players negotiate date/time/court.
3. **PNW (Seattle) leans negotiated**: regulations direct captains to "work
   together" to reschedule; the coordinator records agreements and enforces
   the ~3-week reschedule window.
4. **Every negotiation is bounded**: who proposes, a deadline, and a
   deterministic default on silence (original time stands / coordinator sets
   / season-end double default). Even fully fixed leagues expect
   captain-to-captain confirmation 48h–5d before each match.
5. Unconfirmed: how tennisrecord's feed marks unscheduled flex matches — so
   the import cannot auto-detect league style; the captain chooses it.

### The scheduling model (shipped)

`team_matches.scheduling_status`:
- **fixed** — date (+ optional time) are real; default; only these get cron
  reminders.
- **window** — opponent + play-week known; `match_date` = window start
  (sort/calendar anchor), `window_end` bounds the week, time empty until the
  captains agree. Import toggle "Captains arrange each match" produces these.
- **tbd** — floating; `match_date` = play-by deadline.

**Poll-first "Find a time"**: window/tbd matches offer a captain action that
creates an availability poll prefilled with the play-week's dates
(`availability_polls.for_match_id` links poll → match). The team answers,
the captain picks the winning window, and it resolves into *that* match
(edit-form handoff → fixed status + agreed date/time + seeded availabilities
+ poll closed with `resulting_match_id`). The captain then confirms the slot
with the opposing captain off-app — matching how the regulations describe
bounded captain-to-captain negotiation.

## Phase 1 (shipped with this doc): league identity + format-driven lineups

Schema (`seasons`, all nullable — casual teams unaffected):

- `league_division` — `adult_18|adult_40|adult_55|adult_65|mixed_18|mixed_40|combo|tri_level|other`
- `rating_scheme` — `straight|combined`
- `league_level` — 3.5 (straight) or 7.0 (combined) style values
- `flight`, `usta_team_number`, `area` — display/reference fields
- `lineup_format` — ordered jsonb slots, e.g.
  `[{"code":"S1","type":"singles"},{"code":"D1","type":"doubles"},…]`

Deliberately **no new lineup table**: lineups already live on
`availabilities.lineup_slot`, keyed by `member_id` (works for account-less
placeholder roster rows too), and doubles pairs are two rows sharing a slot
code. The season's `lineup_format` turns that free-text field into a
structured system without a second source of truth or a data migration.

Code:

- `src/lib/leagueFormats.ts` — division/level options, format presets
  (2S+3D, 1S+2D, 1S+3D, 1S+4D, 3D, custom), `parseLineupFormat`,
  `validateLineup` (warning-only: level caps, combined pair sum/gap, slot
  capacity, min-courts), `rosterMinimumFor`. Unit-tested.
- Settings → Seasons tab — league fields on season create + a per-season
  "League" editor (division, scheme-aware level picker, flight, USTA team #,
  format preset/custom picker); season rows show a league summary line.
- Availability page — slot picker offers the season format's slots (+
  Reserve) with per-slot fill counts; match header shows "Lineup n/m courts"
  with warning details; the lineup message lists every format slot in order
  (unfilled = TBD). New matches are tagged with the active season. Teams
  without league fields keep the legacy free-form behavior everywhere.

## Roadmap

- **Phase 2 — scores & record**: per-line score entry on past matches
  (free-form set scores + won/lost), team season record, standings context
  alongside tennisrecord scouting.
- **Phase 3 — playoff eligibility**: per-player played-line counts per season
  vs the 2/3/4 thresholds; roster-minimum indicator on the roster tab.
- **Phase 4 — logistics**: reschedule flow (= a fixed → window transition
  reusing the scheduling states + Find-a-time poll), captain-confirmation
  nudges 48h–5d before fixed matches, join-by-code deep link, typed NTRP
  `{value, type, date}` on profiles.
- **Non-goals**: TennisLink registration/payments, official score sync,
  dynamic-rating computation, hardcoding any yearly rule values.
