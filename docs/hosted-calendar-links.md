# Hosted calendar links

The shared calendar controls now offer:

- **Apple Calendar:** native editor when the iOS plugin is available; otherwise
  navigate to an actual server URL returning calendar content.
- **Copy calendar link:** create a link and copy it for iMessage or other apps.
  A selectable URL field remains available if clipboard permission is unavailable.
- **Google** and optional **Download .ics:** retain the existing alternatives.

`POST /api/calendar/links` accepts a validated, normalized event snapshot. It
requires a signed-in Supabase user or an existing guest RSVP capability with
access to the referenced event. Creation is same-origin only. It does not fetch
private events by guessed ID or use an admin client.

The result contains a relative `path` and `expiresAt`. The browser constructs a
URL using the server-provided `baseUrl`, or the current origin when no override
is configured. `CALENDAR_LINK_BASE_URL` can point local testing at the public
HTTPS origin, provided that origin runs the calendar routes with the same key.

`GET /calendar/shared/{token}/event.ics` is usable without a login cookie and
returns:

```http
Content-Type: text/calendar; charset=utf-8
Content-Disposition: inline; filename="tennis-event.ics"
Cache-Control: private, no-store
X-Robots-Tag: noindex, nofollow, noarchive
```

The route also supports HEAD through Next.js. Invalid links return 404, expired
links return 410, and missing server configuration returns 503. It is a single
snapshot, not a subscription or an invitation with attendee RSVP tracking.
Apple's handling of a link still varies by browser/iOS version; these headers do
not guarantee the native Add dialog.

## Storage and privacy

No database migration or uploaded file is needed. Each URL carries an AES-256-GCM
authenticated, encrypted snapshot. Dates and venue details are frozen when the
link is created; the server does not reinterpret the sender's device timezone.
Event text and roster capabilities do not appear as readable URL parameters.
The recipient can read the event by opening the link, so anyone with the link
can view the snapshot. Do not log tokens or copy them into analytics.

Links expire 30 days after creation. The encrypted snapshot is limited to 4096
bytes (oversized descriptions receive a visible error). URLs can be long because
they contain the snapshot. Repeated copies generate new URLs. Editing/deleting
the original event or revoking an RSVP link does not revoke a previously shared
calendar snapshot. Individual revocation and live synchronization are not
implemented; rotating the server key invalidates all links.

## Configuration and rollout

Set `CALENDAR_LINK_SECRET` to 32 cryptographically random bytes encoded as 64 hex
characters. This is a dedicated server-only key, not a Supabase key. Keep it
stable across deployments and consistent across instances. Never prefix it
`NEXT_PUBLIC_` or commit it.

The dedicated key is configured in Vercel production and in git-ignored
`.env.local`, allowing the local server to mint phone-test links that the public
server can validate. Local `CALENDAR_LINK_BASE_URL` is set to
`https://mytennisfriends.com`. Use a separate key for unrelated staging projects
and do not direct links to a host that uses a different key.
The new web buttons do not require a native rebuild; the existing native editor
still requires the previously implemented Swift plugin.

## Verification

```sh
npx vitest run src/lib/calendarLinkToken.test.ts src/lib/calendarLinkRoutes.test.ts src/lib/nativeCalendar.test.ts src/lib/calendarNormalization.test.ts src/lib/calendarExport.test.ts src/lib/wallClock.test.ts
npx tsc --noEmit
```

Verified locally: 68 tests; TypeScript and targeted lint; real signed-in
calendar-link creation and clipboard success; 375px layout without horizontal
overflow; live anonymous GET and HEAD returning the calendar headers and correct
UTC event times; invalid-link 404. Tests cover expiry, tampering, key rotation,
request size, malformed input, access checks, guest access, all-day dates, and
native save/cancel/error behavior. Actual iMessage → iPhone Calendar behavior
must be checked against the deployed HTTPS URL on a physical device.


## Public deployment (2026-09-07)

Calendar changes and venue dependencies were deployed over production commit
`78eee2a`; unrelated reminder changes and native iOS files were not deployed.
Deployment `dpl_3s4UYHwJfuGmQS2sMUYFM9a8duGw` was verified before promotion to
`https://mytennisfriends.com`. The isolated artifact passed 70 tests and
TypeScript checks, and its remote production build succeeded. An anonymous
request on the public domain returned 200 with `text/calendar`, inline content
disposition, and the expected event data. A native iOS binary was not released.


## Live team subscriptions

Team match cards, team match schedules, and match RSVP cards now share one
stable URL per team: `/calendar/teams/{teamId}/{signature}/matches.ics`. The
feed is named “Team name — Matches” and reads all fixed-date matches across
seasons on every request. Stable match UIDs let calendar clients reconcile
rescheduling and deletions. Refresh frequency is controlled by the client;
the feed suggests one hour. Unscheduled windows are excluded.

Issuing the URL requires membership, ownership, or a valid match-scoped guest
RSVP. The URL itself is a bearer capability signed with CALENDAR_LINK_SECRET.
Anyone possessing it can read that team's schedule and future updates without
logging in. Only schedule fields are returned, never rosters or private notes.
Links do not expire, and leaving the team does not revoke a previously shared
link. Rotating the key revokes all team links and existing snapshot links;
per-team revocation is not implemented. Database failures return 503 rather
than an empty feed so clients do not mistakenly delete their events.

Personal events and practices retain single-event export. Old per-match
subscriptions do not merge automatically: remove those subscriptions once
and subscribe to the new team feed. No database migration is required.

Live team subscriptions deployed as `dpl_59u1GcirzyJpyqP3PLB4ToQFSSBu`
to mytennisfriends.com. The isolated release passed 76 calendar/facility tests,
TypeScript, and the Vercel production build; new files passed targeted ESLint.
At 375px, copy succeeded without horizontal overflow or nested anchors.
Anonymous staged and production GETs both returned one named Slice Society
calendar containing 10 matches. Physical iPhone subscription/refresh behavior
remains to be tested by the owner.


Google team subscriptions use the same stable feed via a Google Calendar
subscription setup URL (`calendar/render?cid=...`), replacing the per-match
Google event template on team cards. The team schedule header and match RSVP
cards share this control. Setup includes Google's documented Other calendars
→ From URL fallback and explains desktop setup/mobile viewing and refresh
delays. Personal/practice Google exports are unchanged. Subscription approval
in the recipient's Google account remains a user action.

Browser verification: Google's `cid` setup rejects a literal HTTPS feed with
“Unable to add calendar”; the same feed expressed as `webcal://` opens its
Add calendar confirmation. The Google helper therefore uses webcal only in
`cid`, while the copied/manual From URL feed remains HTTPS. Confirmed the
dialog without adding a calendar to the owner's account.

Google team UI deployed to mytennisfriends.com in
`dpl_58yKQaMVAtd4X4bGycqZQZM5Kr1m`. Isolated checks: 77 tests and TypeScript
passed; production build passed; public team feed still returned 200 and
10 matches after promotion.
