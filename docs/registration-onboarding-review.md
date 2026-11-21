# Registration onboarding local review

Run an isolated development server:

```sh
TEAM_ONBOARDING_REVIEW=1 WATCHPACK_POLLING=true NEXT_PUBLIC_SENTRY_DSN='' SENTRY_DSN='' npm run dev -- --hostname 127.0.0.1 --port 3105
```

Open http://127.0.0.1:3105/onboarding-preview.

The review route returns 404 outside development or without the flag. In review mode, the authenticated app shell is omitted and middleware blocks other app pages and API routes. The separate build directory avoids interfering with the normal development server. No production database migrations or real messages are involved.

## Review sequence

1. Enter team name and optional description. Step 1 requires no USTA details.
2. Add players using separate name, phone, and email fields, or select fictional existing members. Phone or email is sufficient for a new player. Existing members preview in-app and email notifications.
3. Choose whether to include the description and USTA registration instructions, edit the greeting, review the full message, and simulate invitations. App-only invitations require no USTA fields. USTA instructions require a 10-digit team number and deadline; the registration link is selectable.
4. Add a USTA task from the overview if desired. Confirm one player from TennisLink and review reminders; only unconfirmed players should be included.
5. Reload to check persistence; preview the player information page.

Drafts stay in browser localStorage. Discard local draft clears this review data. The player link is only a same-browser preview, not a remotely shareable team page.

## Validation

- Unit tests: `npx vitest run src/lib/registrationOnboarding.test.ts`
- Browser tests: `npx playwright test --config playwright.onboarding.config.ts` (requires locally runnable Chrome)
- The flow was manually verified in the in-app browser at 375px, including persistence, reminders excluding confirmed players, and player view. The standalone Playwright runner could not launch Chrome under this session's OS restrictions.

## Before release

Connect the flow to authenticated team/season persistence, server-validated SMS delivery and delivery history, and a shareable player page. Reuse roster reconciliation for TennisRecord and captain-confirmed registrations. Direct TennisLink automation remains unverified. Keep registration and app membership independent. Preserve the current established-team import flow.

This document records the isolated preview's development review. For the database-backed implementation, deployed preview, phone acceptance results, and production rollout state, see [team-onboarding-release.md](./team-onboarding-release.md).

## Account association review

Step 2 keeps contact entry and adds an optional fictional friend-account association, both when adding a player and on existing intended-roster rows. Association leaves membership pending and preserves SMS invitations. From the overview, preview one player's invitation and simulate new-account creation or existing-account sign-in and explicit acceptance. Acceptance keeps the same roster ID and USTA confirmation; repeated acceptance does not create a second membership. Real auth, account lookup, personal invitation credentials, and team-page membership are not connected.

Verified in-app at 375px: friend association, pending status, wrong-account rejection, acceptance, and joined status. Unit tests also cover new/existing accounts, duplicate account protection, repeat acceptance, and USTA history preservation.

## Sign-in acceptance update

Phone verification has been removed. The local player preview has two stages: simulate Google, Apple, or email sign-in, then explicitly accept the invitation. Associated accounts must match, with a Switch account path. Unassociated invitations may be accepted by any signed-in account holding the personal link. Sign-in alone does not join the team. Production still needs authenticated server validation of a single-use invitation credential, expiry/revocation, and membership persistence.
