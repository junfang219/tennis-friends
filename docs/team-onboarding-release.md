# General team onboarding: production integration

## Pending PR #32: create team → Roster → Invite players

The application is unmerged and undeployed. `/groups/new` now collects only team name and optional description. Create team saves those details and opens `/groups/:id/roster` directly. A server-only loader reads the current roster without importing browser query helpers. The Roster page shows Invite players immediately and supports join-request review, existing role management, member types, account linking, and removal. Creation retries do not replace a roster that has already changed.

- The team-page Invite players button and the Roster action open the same `/groups/:id/invite-players` page. Team Settings → Roster opens the canonical Roster page. The old underlined Manage invitations and registration entry is removed; `/groups/:id/onboarding` redirects to Roster.
- Invite players starts with Share team link and Send by email. Sharing requires no player details and retains approval before membership. Email fields appear only for email delivery; names are optional. Batch sending targets only selected recipients, preserving other pending invitations. No phone entry or setup stepper remains.
- Existing personal invitations remain usable and visible, including earlier `group_invites` with their assigned roles and member types. Pending invitation renewal, revocation, and recipient correction remain available. Adding friends and guest availability are retained under More ways to add people; their live actions are disabled in the isolated review fixture.
- `/groups/:id/registration` is the separate USTA registration section, reachable from the team, Roster, and Team Settings. It owns optional team details/deadline, Confirm → Undo, and targeted email/manual reminders. Email instruction opt-out does not disable tracking. Existing friends and earlier members are synchronized without losing roster IDs, confirmations, or availability history.
- New scoped changes use the checked `patch_team_onboarding` RPC. The team is locked before reading the current roster; message/registration edits do not replace the roster. Recipient corrections keep confirmations and revocation intact. Member removal retires its invitation/reminders while preserving registration history. Roster mutations run through authenticated server routes and existing RLS/role guards.

The already approved shared-link migration is installed in production as `20261117162141_shared_team_join_approval.sql`; do not reapply it. This revision also needs the additive `20261117174222_roster_first_team_management.sql` migration before using the new mutation controls. It adds a private checked implementation and public invoker wrapper; applying it does not update existing team data. Its hosted application is pending separate approval because the local app uses the production database.

Verification: 678 unit/route tests, 32 browser cases at 375px and desktop, and 74 embedded PostgreSQL checks pass. TypeScript, changed-file ESLint, and diff checks pass; the team page's three existing image warnings are unchanged. Automated tests use isolated fixtures and send no real messages. The review middleware rewrites only the fixed fixture team's canonical routes and blocks live APIs; friend/guest actions cannot reach live data in review mode.

### Shared-link migration verification — November 17, 2026

- Applied only the reviewed additive migration. Before/after fingerprints matched for profiles, groups, memberships, onboarding settings, intended players, delivery records, and all existing public function definitions.
- Both new tables have RLS enabled and no anonymous or authenticated direct table reads. Anonymous execution of request creation is denied; the public RPC wrappers are security invokers.
- The advisor delta has no new security warnings. Two informational [RLS-without-policies notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) describe the intentionally closed RPC-only tables. New unused-index notices are expected before traffic; existing unrelated advisories were unchanged.
- Reloaded the user's local Overview for team `2222`, confirmed the setup error disappeared, and created its shared link through the signed-in captain UI. The link field, Share team link, Copy link, and the success message appeared. No join request, membership, or email was created by this verification.
- The generated link currently points to the local app on port 3110. PR #32 is not merged or deployed, so do not distribute a production-domain shared link until the application release.

## Current production release — November 15, 2026

- PR #28 merged into `court-booking-embedded` as `71d10f1`.
- Production deployment `dpl_HrdfYFxjSWWWrDmN9j49ryNoPLVV` is READY and serves `https://mytennisfriends.com`. `NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED=true` is configured in Vercel Production and included in the build.
- Follow-up migration `20261116043105_fix_team_onboarding_invitation_lifecycle.sql` is applied. Its local filename matches hosted migration history; do not reapply either onboarding migration. Player and membership row fingerprints were unchanged by migration application.
- Google sign-in returned to the production team creation page. Created a controlled test team and prepared a personal invitation with the canonical production origin. The native share sheet sent it through Messages to the previously authorized test recipient. No automatic email was sent.
- The signed-out public invitation was inspected at 375px and requires sign-in before acceptance. The authenticated friends API correctly rejects signed-out requests (401), and the development-only preview renders not-found. The initial deployment error-log check returned no errors.
- The recipient accepted a fresh invitation as `yuchaoran2011@gmail.com`. Database verification confirms exactly one membership for that account, two account-backed members total, and authenticated row-security access to the team and both members. Earlier preview acceptance results below are separate evidence.
- The recipient reported indefinite loading on the phone; Safari reproduced an auth initialization/Web Lock stall. PR #29 upgrades the pinned Supabase client from 2.106.1 to 2.119.0, using upstream refresh single-flight and session commit guards instead of the browser mutex. Deployment `dpl_CTTxRK76oqPgXJUn8QfTzwn5B6BL` (application commit `d6c927d`) is READY on the canonical production domain with onboarding enabled. The previously stuck Safari session now loads the team and Communities, displaying Jun Fang and Chaoran Yu as the two members. Chrome also passed. All 573 tests, TypeScript, changed-file ESLint, and the remote production build passed; the initial deployment error scan returned no errors. The recipient confirmed that the team now loads on the receiving phone while using the intended account, completing the reported acceptance-to-Communities loading retest.

The production implementation is separate from `/onboarding-preview`. It contains no simulated sign-in, sample friend accounts, or browser-only team storage.

## USTA confirmation and reminder pilot — November 15, 2026

- Used `Production Onboarding Test — Jun` with the already accepted Gmail recipient. At the user's request, configured `TEST ONLY — No real USTA team`, placeholder number `0000000000`, and deadline November 22, 2026 (one week from the user's local date). The description and messages identify the test, and the external USTA registration link is disabled.
- Confirmed the Gmail player through the captain controls, reloaded, and verified the stored confirmation. Reminder review excluded that player. The first preparation attempt exposed a request-validation bug: PostgreSQL returns `confirmed_at` with a `+00:00` offset, while the input schema accepted only `Z` timestamps.
- PR #30 accepts valid ISO timezone offsets and retains malformed/unzoned timestamp rejection. Application commit `5c78b7d` is deployed to production as `dpl_6EsxGNsGUyTX51hw6GBFnLf8kXAT`, READY at the canonical domain. All 32 focused onboarding/reminder tests, TypeScript, changed-file ESLint, diff checks, and the remote build passed. The initial deployment error scan returned no errors. No migration was needed.
- After deployment, repeated confirmation → full reload → reminder preparation. Preparation succeeded and omitted the confirmed Gmail player. Undid the confirmation, reloaded again, and verified `confirmed_at IS NULL`, exactly one recipient membership, and that the Gmail player was included in prepared reminders again.
- Shared only the Gmail player's personal reminder through the native share sheet and sent it in Messages to the authorized phone ending in 7749. The older phone-only onboarding row belongs to the earlier captain-accepted invitation; its prepared reminder was not sent. Messages showed the new outgoing reminder and an empty composer. No automated email was sent (delivery table remains empty). The recipient confirmed receipt on the phone ending in 7749 and successfully opened the team from the reminder link, completing the phone reminder test.

## Email invitation and reminder pilot — November 15, 2026

- Created `Email Onboarding Test — Jun` (`7529de09-a044-48aa-837b-7af2eb02ca1b`) with exactly one intended recipient, `yuchaoran2011@gmail.com`. The prior phone-test team's older captain-linked row would also receive a batch email, so this separate team keeps delivery restricted to the requested recipient. Reused the clearly labeled test USTA task (`0000000000`, November 22, 2026) with the external registration link disabled.
- Sent one invitation through the production onboarding UI. Its delivery record is `sent`, and the connected recipient Gmail account received it in `INBOX` at 10:02 PM Pacific. Verified sender, recipient, test-only body, deadline, personal join link, and passing SPF/DKIM headers. The public invitation was inspected at 375px and requires sign-in before acceptance.
- The recipient reported accepting and reopening the link from the email. Database verification confirms acceptance as the intended Gmail account at 10:03 PM Pacific, exactly one recipient membership, and no remaining placeholder.
- Temporarily confirmed registration through the captain UI. Reminder review showed no unconfirmed recipients; attempting email reminders returned `No recipients`. The delivery table and Gmail both remained at one message, proving no email was created for the confirmed player.
- Undid the temporary confirmation and sent one email reminder through the production UI. Gmail received the second message in `INBOX` at 10:06 PM Pacific with passing SPF/DKIM. Its body begins with the USTA reminder and includes the same personal invitation link already accepted and reopened by the recipient. Gmail groups both messages in the same thread because the reminder currently uses the invitation subject.
- Final verification: two successful email delivery records, zero failed/pending deliveries, exactly one recipient membership, and `confirmed_at IS NULL`. The recipient is left unconfirmed. This test needed no application changes or deployment.

## Implemented

- `/groups/new`: authenticated team-name/description → intended-player contacts and optional real-friend association → invitations and optional USTA instructions.
- `/groups/:id/onboarding`: database-backed overview, manual USTA confirmation, targeted reminders, revocation, and edit/save.
- `/team-invitations/:token`: personal invitation, real app sign-in through `/login`, explicit acceptance, associated-account checks, expiry, revocation, and membership conversion/merge.
- Accepted teams use the existing `group_members` table, so they appear in the existing Teams page.
- Associated recipients see pending invitations in the Teams inbox after delivery; phone invitations are shared by the captain through their own messaging app. Associated-account email is used when no separate email was entered.
- Phone invitations use the native share sheet with a copy-message fallback. The captain chooses the recipient and sends; the app cannot confirm text delivery. Email uses Resend and is a separate explicit action.
- Email delivery batches claim `(player, batch, channel)` before contacting Resend. Retries use the same batch ID. A failed/unknown delivery must be reviewed before creating a fresh batch. Preparing a shareable link does not create a provider-delivery record.
- Existing USTA import remains accessible via `/groups?setup=existing`.

## Enable after setup

1. Review and apply `supabase/migrations/20261115182308_team_onboarding.sql` to a **staging** copy of the current canonical schema first. It adds three RLS-enabled tables and restricted RPCs. It reuses `_merge_placeholder_into_user` and does not replace the existing invite flow.
2. Set `ONBOARDING_PUBLIC_ORIGIN` to the canonical public HTTPS origin; never a localhost preview URL for live recipients.
3. No Twilio setup is required. Test the native share sheet on the captain’s phone and the copy-message fallback on desktop.
4. Set `RESEND_API_KEY` and `ONBOARDING_EMAIL_FROM` to a verified sender. The existing server-only `SUPABASE_SECRET_KEY` is also required for delivery records.
5. Test with controlled accounts and recipients in staging, including associated/nonassociated social accounts, confirmation preservation, declined/expired links, duplicate requests, provider rejection, and revocation.
6. Apply the reviewed migration to production, then build/deploy with `NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED=true`. Leave `TEAM_ONBOARDING_REVIEW` unset. The default flag is false, preserving the existing Create Team UI until setup is complete.

The migration was applied to the live TennisFriend database on November 15, 2026 with user authorization (migration version `20261115182308`). No invitation was sent and no application deployment was performed. The new onboarding UI remains disabled by default. SMS credentials, invitation origin, and email sender were missing in the local environment when checked.

## Verification performed locally

- Optimized Next.js production build passed with isolated build-time service values; no live database or provider calls.
- TypeScript passed.
- New production files pass ESLint. The existing groups page has pre-existing `react-hooks/refs` failures in swipe handling; these are outside the onboarding changes.
- 17 focused unit tests cover parsing, spoofed-field rejection, duplicate contacts, account linking, provider calls, missing sender configuration, and provider failure handling.
- 17 embedded PostgreSQL checks execute the actual migration and canonical roster-merge function against a minimal fixture: manager permissions, no anonymous table reads, unsent link rejection, account mismatch, repeat acceptance, preserved roster identity/USTA history, email-only account acceptance, revocation, and renewal invalidating the old link.

Run database verification without touching hosted services:

```sh
ONBOARDING_PGLITE_MODULE=/path/to/pglite/dist/index.js node scripts/test-team-onboarding-db.mjs
```

PGlite is a test-only runtime and is not added to the application dependencies. The fixture does not reproduce every deployed trigger/policy, so staging verification remains required.

## Known boundaries

### PR review corrections

The follow-up migration `20261116043105_fix_team_onboarding_invitation_lifecycle.sql` must be applied before releasing the corrected application. It replaces only the save and acceptance RPCs, retaining their authorization checks and restricted permissions. The original migration remains unchanged. This follow-up was applied to the hosted database on November 15, 2026, with explicit user authorization (hosted migration version `20261116043105`). The local filename matches hosted history. Before/after fingerprints of all onboarding players and memberships matched; only the two RPC definitions changed. Anonymous execution remains denied and authenticated execution remains allowed.

- Revoked and removed associations no longer block a replacement invitation. Another active association still blocks acceptance, and merging preserves a single membership.
- Saving a revoked player's corrected contact details/account association now persists the changes and updates the placeholder. Recipient changes rotate the credential and clear issuance while keeping the invitation revoked. Explicitly renew and prepare/send it before sharing; previous links remain invalid.
- Joined players who have not completed USTA registration can receive email or shareable reminders after join-link expiry. Expired unaccepted invitations and revoked invitations remain blocked, and confirmed players are excluded.

Regression verification covers the correction/replacement lifecycle in embedded PostgreSQL and both reminder delivery modes in route tests. Production onboarding is now enabled as recorded in the current release above.

### Existing boundaries

- USTA confirmation is captain-managed. Automatic TennisLink ingestion is not implemented.
- Invites without an associated account are bearer invitations: anyone holding the personal link can accept after signing in. Sign-in identifies the accepting account, not ownership of the invited phone.
- Invitations expire after 30 days; captains can prepare and send a replacement link for expired/revoked invitations while preserving the intended roster entry.
- The onboarding record represents the current team's onboarding task, rather than a full multi-season registration archive.

## Live database migration verification — November 15, 2026

- Checked live columns, defaults, constraints, existing roster merge and authorization helpers, and team triggers before applying. No naming conflicts were found.
- Applied only three new tables, their indexes/security permissions, and seven new functions; existing function definitions were not replaced.
- Before/after row fingerprints matched for all 44 profiles, 14 groups, and 95 memberships. The fingerprint of existing public function definitions also matched.
- All three new tables are empty and have RLS enabled. Anonymous and signed-in clients have no direct table read privileges; access is through the restricted functions.
- Unknown invitation lookup returns null and the signed-out invitation inbox is empty. No test account, membership, or notification was created in production.
- Security advisor additions are expected for these RPC-only tables (RLS with no direct policies) and the deliberately public token-based invitation view; existing unrelated notices were left unchanged.
- `NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED` remains unset/false locally. No Vercel settings or deployment were changed. End-to-end invitation testing and delivery configuration remain outstanding.

Do not reapply this migration: its filename matches the hosted migration history.

## Delivery configuration — November 15, 2026

- Checked Resend's domains API using the existing local key: HTTP 200; `mytennisfriends.com` is verified. This is configuration verification, not a delivery test.
- Configured `ONBOARDING_PUBLIC_ORIGIN=https://mytennisfriends.com` and `ONBOARDING_EMAIL_FROM=TennisFriend <invites@mytennisfriends.com>` locally and in Vercel Production. Reused the existing Resend key; no credentials were copied into source files.
- Explicitly set `NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED=false` locally and in Vercel Production. Vercel changes take effect on a future deployment; no deployment was triggered.
- Twilio credentials and a Messaging sender/service are absent locally and in Vercel. SMS configuration and delivery testing are blocked until supplied through local environment settings or Vercel secrets.
- No test recipient was specified, so no SMS or email was sent. Confirm the user's test email and phone before sending. End-to-end sign-in/acceptance testing remains pending; the public invitation route is not deployed yet.

## Captain-sent text invitations — November 15, 2026

The implementation now retains the original captain-sent approach. Prepare invitations activates each personal link, then shows a message per player with Share and Copy actions. The captain sends through Messages or another chosen app. Email invitations/reminders remain a separate Resend action. No automatic SMS or text reminders are sent, and no Twilio credentials are required. `sent_at` is treated as invitation issuance/readiness rather than proof of text delivery. The existing schema and account-bound acceptance checks are unchanged; no additional database migration was needed. Earlier Twilio setup notes above describe the superseded implementation.

The requested standalone test email was delivered to the user’s confirmed test inbox by Resend. Full invitation acceptance and device sharing tests remain pending. No further test messages were sent for this change. The production feature flag remains false; these source changes have not been deployed.

## Local browser test fixes — November 15, 2026

The Turbopack development server failed to discover `/auth/callback` while reporting file-watcher exhaustion. Restarting on port 3110 with Webpack and `WATCHPACK_POLLING=true` restored the callback route (HTTP 307 instead of 404). A signed-in browser then exposed an API import of a `use client` friends helper; onboarding now uses a dedicated server-only helper with runtime validation and minimal profile fields. Production was not redeployed.

## Deployed phone test — November 15, 2026

- Deployed the current workspace to the Vercel Preview environment: `dpl_GHMyLX4BMY4cJvT9nyyq8aNetyH6` (`tennis-friends-9eoitm5tm-yuchaoran2011s-projects.vercel.app`). The deployment is READY; production was not deployed and its onboarding flag remains false.
- Enabled onboarding for this preview. Excluded `.next-onboarding-review` from Vercel source uploads.
- The 21 focused unit tests and TypeScript check passed; the remote production build passed. A signed-out request to the deployed friends API correctly returned HTTP 401.
- Google sign-in initially returned to production because the existing redirect pattern did not cover the preview callback with query parameters. With explicit user approval, added only this deployment's `/auth/callback**` rule to Supabase. Retried Google sign-in and verified return to the deployed onboarding page.
- Existing `Onboarding Test — Jun` records show two accepted players, each linked to exactly one membership. Created `Phone Onboarding Test — Jun` (`e8099b7f-f89d-45e9-a158-e4e29052beed`) for a fresh acceptance test rather than modifying accepted invitations.
- Prepared one personal invitation through the deployed UI, opened the native share sheet, selected Messages, and sent it to the user-specified test number. Added this preview's 24-hour share-access parameter to the outgoing link so the recipient does not require Vercel membership. This is preview-only access, not part of the production invitation format.
- The recipient reported completing phone sign-in, acceptance, and reopening. Database verification confirmed acceptance at 8:04 PM Pacific on November 15, exactly one membership for the accepting account, two account-backed team members total, no remaining placeholders, and a valid link from the invitation to the converted membership. The accepting account used iCloud rather than the originally suggested Gmail test account. This invitation had no account association before acceptance, so that is permitted bearer-invitation behavior; an entered contact email does not bind the accepting account. No automatic email was sent.
