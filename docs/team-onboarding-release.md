# General team onboarding: production integration

The production implementation is separate from `/onboarding-preview`. It contains no simulated sign-in, sample friend accounts, or browser-only team storage.

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
