# General team onboarding: production integration

## Pending PR #32: two-step setup → Roster

The application is unmerged and undeployed. `/groups/new` now collects only team name and optional description. **Create team & continue** saves those details, prepares the optional shared approval link, and opens optional invitations at `/groups/:id/invite-players?setup=1`. **Go to Roster** finishes or skips invitations. Successful new SMS/email invitation batches finish on Roster; failed or pending batches stay on step two for review. Back opens `/groups/:id/setup-details` for the same saved team, and **Save & continue** updates only its name and description. The initial creation request is never replayed to edit the team. A server-only loader reads the current roster without importing browser query helpers. The Roster page shows Invite players immediately and supports join-request review, existing role management, member types, account linking, and removal. Creation retries do not replace a roster that has already changed.

- The team page has one **Rosters** entry beside the member avatars. It replaces Members and the separate Roster, Invite players, and USTA buttons. The canonical Roster page contains Invite players, member management, and per-player USTA confirmation status. Team Settings → Roster opens this same page. The old underlined Manage invitations and registration entry is removed; `/groups/:id/onboarding` redirects to Roster.
- Invite players defaults to **Send by SMS**, with **Send by email** beside it and **Share a team link instead** below as a secondary option. SMS asks for phone numbers and optional names; email asks for addresses and optional names. Both send personal links that recipients can accept directly. Shared links need no player details and retain captain approval. Each method preserves its draft when switching, and batches target only selected recipients. The two-step progress indicator appears only during initial setup; later Invite players visits use normal Roster navigation.
- Existing personal invitations remain usable and visible, including earlier `group_invites` with their assigned roles and member types. Pending invitation renewal, revocation, and recipient correction remain available. Adding friends and guest availability are retained under More ways to add people; their live actions are disabled in the isolated review fixture.
- Roster contains an expandable USTA registration section with details/deadline and targeted email/manual reminders. Confirm → Undo appears beside each tracked player, with a confirmation count in the section summary. The existing `/groups/:id/registration` URL remains available for compatibility. Prepared reminders are hidden when their player is confirmed. Email instruction opt-out does not disable tracking. Existing friends and earlier members are synchronized without losing roster IDs, confirmations, or availability history.
- New scoped changes use the checked `patch_team_onboarding` RPC. The team is locked before reading the current roster; message/registration edits do not replace the roster. Recipient corrections keep confirmations and revocation intact. Member removal retires its invitation/reminders while preserving registration history. Roster mutations run through authenticated server routes and existing RLS/role guards. Leave/Delete actions previously offered by Members remain in a collapsed Team actions menu on Roster, with their existing confirmations and owner restrictions.

The already approved shared-link migration is installed in production as `20261117162141_shared_team_join_approval.sql`; do not reapply it. The separately approved scoped-edit migration is also installed as `20261117181245_roster_first_team_management.sql`. Its local filename matches hosted migration history; do not reapply it. It adds a private checked implementation and public invoker wrapper without updating existing team data during installation. The local app can now use the new save controls.

Verification: 757 unit/route tests and 84 browser cases at 375px and desktop pass. The earlier 149 embedded PostgreSQL checks and eight real PostgreSQL concurrency tests also pass; their SQL and fixtures are unchanged by the loading revision. TypeScript, changed-file ESLint, and diff checks pass; the team page's three existing image warnings are unchanged. Automated tests use isolated fixtures and send no real messages. The review middleware rewrites only the fixed fixture team's canonical routes and blocks live APIs; friend/guest actions cannot reach live data in review mode.

### Team details → Invite players loading — November 18, 2026

- Invite players now receives a validated server snapshot with its first render. The page authenticates once, starts the roster, onboarding RPC, and legacy-invitation reads concurrently, and shares its roster promise between permission checks and snapshot assembly. The manager RPC independently checks current access; an access denial never becomes a serialized snapshot. The GET API uses the same server-only loader for subsequent refreshes.
- The invitation editor initializes from that snapshot and skips the redundant browser GET and Loading invitations screen. Different team IDs remount the editor so another team's draft/snapshot cannot carry over. Existing Send paths still fetch fresh readiness/recipient versions before saving or delivering; no permission check or delivery claim is skipped. Client-only review fixtures retain their fallback loader.
- Removed the extra router refresh immediately after creating/editing team details. Navigation performs one transition to step two. SMS readiness/config validation lives in a lightweight server-only module; displaying invitation fields does not import Twilio or Resend SDKs. Credentials remain server-only and the browser receives readiness booleans only.
- Regression tests cover parallel reads while the roster is pending, one authentication/roster lookup, denied manager access, older-team defaults, malformed state, and failed legacy reads. Six mobile/desktop cases verify that the form is in server HTML, a failed redundant GET cannot block it, changing method needs no fetch, stale SMS readiness is refreshed before writes, and team creation performs one navigation. All 757 PR-only unit/route tests and 84 browser cases pass; TypeScript, changed-file ESLint and diff checks pass. A clean source snapshot excludes unrelated local court edits. The existing signed-in local team's invitation page also renders the form successfully against the current database without saving data or sending messages.
- This reduces request count and removes the client hydration/fetch waterfall; it does not guarantee a fixed elapsed time. Saving the team, validating access, database latency, and first-use development compilation still take time. No additional migration or production deployment is required by this revision. The earlier permission/renewal follow-up remains pending production installation.

### PR review corrections: manager revocation and expired drafts — November 18, 2026

- Added follow-up `20261119031146_recheck_team_managers_and_recover_expired_drafts.sql`. It rechecks manager access after taking the team lock in shared-link management, request approval/rejection, scoped roster/registration edits, and invitation renewal. A request queued before manager removal/demotion cannot complete with stale authority. Existing applied migrations are unchanged.
- Expired, unissued SMS/email invitations show an explicit Renew expired invitation action. Their Send controls return after renewal; the usual Manage invitation menu stays hidden until issuance/revocation. Renewal rotates the token and extends expiry for the same player/member, retaining contacts and USTA confirmation. Preparing a replacement link sends nothing. Any unresolved SMS or email delivery blocks renewal with a specific 409 response. Joined/removed players remain ineligible.
- Renewal uses a private checked implementation with an empty search path and an authenticated-only public invoker wrapper. The migration changes function definitions/grants only and updates no business records during installation. It is **prepared and tested locally, not applied to production**. Apply it before releasing these fixes; no app deployment or live messages were performed.
- Added real concurrent-transaction regressions using a temporary Unix-socket-only Postgres cluster: approval, rejection, contact visibility, shared-link replacement, registration edits, member removal, and renewal are denied after revocation while waiting. Authorized managers still succeed. The approval regression fails against the pre-fix code and passes with the follow-up. Denied actions preserve every affected record except the owner's intended revocation.
- Added expired-draft recovery checks for stable player/member IDs, contacts, confirmations, token rotation/expiry, pending-delivery rejection, and duplicate-free acceptance. Six mobile/desktop browser regressions cover SMS/email recovery and unresolved delivery, alongside four route tests. Full verification: 747 unit/route tests, 78 browser cases (375px and desktop, clean runner exit), 149 embedded database checks, eight real concurrency tests, TypeScript, targeted ESLint, and diff checks pass. Automated provider calls remain intercepted. Catalog checks verify restricted execution, empty search paths, and the renewal invoker wrapper.

### Twilio configuration verification — November 18, 2026

- Imported the user's credentials into the gitignored, mode-0600 local `.env.development.local` and Vercel Production sensitive variables. Also configured the Messaging Service and public SMS origin in both environments. Verified local values match the entered values and the four Production variable names are present. No credential values were logged or committed; the temporary credential-entry file was removed.
- Read-only Twilio API requests authenticated and confirmed the intended TennisFriends Invitations service and its attached existing sender ending 5267. The campaign status is `IN_PROGRESS` with use case `SOLE_PROPRIETOR`; a service registration flag is not campaign approval.
- Saved and re-read branded HELP/STOP/START responses, keyword lists, and enabled Advanced Opt-Out. Switched inbound handling to Receive the message without a service webhook, bypassing the number's old demo SMS webhook while retaining voice settings. Exact saved responses and operational details are in [SMS setup](sms-setup.md).
- No SMS was sent. Actual HELP replies, STOP enforcement, START resubscription and invitation receipt/acceptance remain unverified until a controlled test after campaign approval. Production secrets apply on the next deployment. This configuration did not merge PR #32, deploy application code, change database records, or configure Preview credentials.

### Policy-only production publication — November 18, 2026

- With explicit user approval, published only the policy files via merged PR #33: `/terms`, `/sms-consent`, SMS disclosures in `/privacy`, and the shared script text. Based on the prior production commit `bea254b`; scoped source commit `dbb5da4`, merge commit `10056e7`. The staged build's source tree matched the merge tree exactly. No onboarding UI/delivery logic, unrelated court edits, or migration was released.
- Staged and verified production build `dpl_HMp4QykNBYvJuLg4KYMVe8UBRW5L`, then promoted it to `mytennisfriends.com`. The staged pages were checked for actual policy content after the build reached READY, using authenticated Vercel requests without changing deployment protection.
- All three canonical production URLs return 200 without sign-in at 375px and 1280px, including JavaScript disabled. Policy links, the exact SMS privacy disclosure, SMS terms, and the verbal script were verified. All three hydrated pages also load with zero browser errors. The deployment's scoped error/fatal log scan returned no records.
- Production policy publication does not enable SMS sending or approve the Twilio campaign. PR #32 remains open for the rest of the onboarding changes. Provider HELP/STOP and credentials were configured subsequently; campaign approval and the controlled delivery test remain outstanding. See the Twilio configuration verification above.

### Verbal consent and public SMS disclosures — November 18, 2026

- Added public server-rendered `/terms` and `/sms-consent` pages, with the full verbal script, optional SMS choice, one invitation per consent request, manual consent-record instructions, HELP/STOP and support instructions, and linked policies. Updated `/privacy` with invitation contact data, SMS use and delivery providers, and the required statement excluding marketing sharing of SMS consent data. Invite players links to the script in a new tab while retaining its draft.
- The Twilio proof field shown during this registration accepts the verbal script inline; a hosted script is optional there. Live public privacy and terms links remain required. These pages were prepared in PR #32 and subsequently published separately through PR #33; see the policy-only publication above.
- All three pages return 200 anonymously with JavaScript disabled at 375px and 1280px, with no horizontal overflow. The required privacy sentence is present in server-rendered output. Six existing SMS sending/validation/draft browser cases also pass across mobile and desktop. TypeScript and changed-file ESLint pass. The React checklist found no new client boundary, effect, dependency, or data-fetching work in the policy pages.
- Captains maintain their own dated verbal-consent records. The app's checkbox does not automatically record a conversation or the captain's notes. Twilio account upgrade and Brand approval were observed in user-provided screenshots; Campaign approval, provider HELP/STOP configuration, credentials and live SMS delivery remain separate steps. No message was sent and no production application deployment occurred.

### SMS setup checks and reloaded drafts — November 17, 2026

- Re-entering an existing unissued phone after a reload reuses its player ID and preserves its saved name when the name field is blank. The database also deduplicates under the team lock. Issued/joined contacts are rejected with specific guidance, and a fresh draft cannot bypass a revoked contact's unresolved delivery.
- The manager GET returns only SMS credential/public-origin readiness flags. The SMS form checks fresh readiness before saving contacts or USTA details, retaining the draft and showing a clear setup message when unavailable. Pending-entry sends also refresh readiness. No credentials reach the client. Readiness does not validate provider account status or registration.
- Optional server-only `ONBOARDING_SMS_PUBLIC_ORIGIN` lets local SMS use the deployed personal invitation route without changing local email/shared links. Malformed SMS-only settings cannot break email. See [SMS setup](sms-setup.md) for account checks, current trial restrictions, sender setup, and a controlled receipt/acceptance test.
- Installed `20261118041221_reuse_unissued_sms_drafts.sql`; its local filename matches hosted history. It replaces only the existing checked private SMS-edit function. Business records and unrelated function fingerprints matched before/after; security-advisor findings were unchanged. The originally failing team's same-phone/new-ID request succeeded as its owner in a rolled-back transaction, with one unissued draft and no delivery attempts. No real message was sent.

### Atomic delivery claims and safe draft retries — November 17, 2026

- The sending API validates the form's recipient versions and then calls `claim_team_onboarding_delivery`. Its private implementation rechecks manager access, locks the team and player, compares the current destination/account/token with the expected version, and captures a private delivery snapshot before any provider call. A stale read returns changed/unavailable without sending. A contact guard also covers legacy/full saves and privileged edits while delivery is pending or an unrevoked credential is issued.
- Each request carries its own validated message, USTA inclusion choice and registration details. The first claim stores the batch's settings; remaining recipients and retries use that immutable snapshot. Another tab's saved preferences cannot replace the outgoing content. Form drafts remain fixed across roster reloads, and delivery identity includes recipient versions so a safe correction starts a fresh batch. Existing pending/sent claims are counted without another provider request.
- Phone/name corrections in the original SMS form now update the same unissued draft through the scoped recipient path. Accepted, issued, revoked and uncertain-delivery protections remain enforced; no stale full-roster save is introduced. Canonical invitation acceptance can bind the unchanged contact to a real joined membership, including legacy delivered email invitations. Contact redirection still cannot bypass the guard.
- Installed follow-ups `20261118034837_atomic_onboarding_deliveries.sql` and `20261118035150_allow_acceptance_with_delivery_guards.sql`. Both local filenames match hosted history; apply both in order on a new environment and do not reapply either to this project. They add a nullable snapshot column, an index for batch lookup, a manager-checked public-invoker claim RPC, an internal contact guard, and the scoped draft correction. The snapshot column remains behind existing closed table permissions/RLS. No existing business records are rewritten by installation.
- Existing business data and unrelated function fingerprints matched before/after (excluding the new nullable column and intentionally replaced SMS/guard functions). A real owner claim and pending-edit rejection succeeded in a transaction that was rolled back; final fingerprints were unchanged. PostgREST exposes the claim RPC while denying anonymous execution (401/42501). Security-advisor findings are unchanged.
- Regression checks cover both race orderings, post-claim edit rejection through legacy saves, claim-derived destination/token/content, immutable USTA opt-in/out across batches, same/cross-batch pending protection, original-form corrections after configuration/provider failure, stale form versions, changed manager permissions, and SMS/email acceptance with duplicate prevention. Browser tests overlap requests from two tabs and check that pending retries retain their tab's draft. No real message was sent. Production application deployment remains separate.

### Include USTA registration with invitations — November 17, 2026

- Invite players now has an optional **Include USTA registration instructions** choice for SMS and email. Checking it reveals USTA team name, the required 10-digit team number and deadline, and an optional TennisLink registration URL. Fields start from saved settings and retain edits when switching delivery methods.
- The existing Send action saves changed registration details through the scoped registration API before sending, so the provider message includes the number/deadline and selected URL. There is no extra save button or navigation step. Invalid or incomplete registration input blocks sending; unchecking the option omits instructions without disabling existing Roster tracking or changing confirmations. Delivery batch identity includes the selected registration details.
- Regression tests cover both delivery methods, optional/required fields, method switching, saving before delivery, confirmation preservation, instruction opt-out retaining tracking, and actual provider message content. No migration or live data change is required for this UI revision.

### Automatic SMS invitations — November 17, 2026

- SMS is the default method for setup and later Invite players visits. Phone numbers normalize to E.164; national US/Canada format and explicit international country codes are supported. Names are optional, normalized duplicate numbers are rejected, and the captain confirms recipients agreed to the invitation before sending. Phone-only recipients have no fabricated email address. Email and the secondary shared approval link remain available.
- The existing Twilio SDK sends each personal invitation from the configured Messaging Service or sender number, with TennisFriends identification and STOP instructions. UI reports **provider acceptance**, not handset delivery. SMS-only validation never falls back to email or contacts another pending recipient. Missing/invalid configuration, private/non-HTTPS link origins, oversized text, unknown recipient IDs, and joined players fail before sending. SMS reminders are deliberately not enabled by invitation consent; USTA reminders remain email/manual.
- Twilio POST retries are disabled. A database claim precedes each provider call. Same-batch retries reuse the claim, and a partial unique index prevents another batch while an SMS attempt is pending. Explicit provider rejection is failed; network timeouts, server errors, and uncertain acceptance remain pending for provider reconciliation. Unknown SMS attempts are not automatically retried. See [Twilio message statuses](https://www.twilio.com/docs/messaging/api/message-resource).
- Installed `20261117221430_automatic_sms_team_invitations.sql`: scoped manager-checked phone recipient edits and the pending-SMS unique index. Public RPC is an invoker; private code has an empty search path and locks/rechecks team management. Existing roster, invitation, settings, and public/private function fingerprints were unchanged. An owner phone-only draft save succeeded inside a rolled-back transaction; final fingerprints were unchanged. Anonymous API execution returns 401/42501 and security-advisor findings are unchanged. Local filename matches hosted history; do not reapply it.
- Tests cover actual migration execution, scoped edits/tenant isolation, phone normalization, Twilio invocation with the existing SDK, consent, configuration, personal URLs, provider rejection/uncertainty, duplicate claims and cross-batch pending blocks, recipient correction preserving revocation and confirmation, method switching, SMS completion to Roster, validation failure, unconfigured sending, and keeping pending sends on step two with the original batch. Provider tests intercept all requests. No real SMS or email was sent, and no real roster/confirmation was permanently edited.

#### Configure and verify SMS

1. Set server-only `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and either `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`. Use an SMS-capable sender already enabled for the intended destinations. Local values go in `.env.development.local`; configure Preview/Production separately in Vercel. Never prefix these values with `NEXT_PUBLIC_` or paste credentials into chat. Twilio Verify credentials alone do not configure invitation SMS.
2. Use a public HTTPS invitation deployment. `ONBOARDING_SMS_PUBLIC_ORIGIN` overrides the SMS link origin; otherwise SMS uses `ONBOARDING_PUBLIC_ORIGIN` (or the Vercel preview URL). For local testing set `ONBOARDING_SMS_PUBLIC_ORIGIN=https://mytennisfriends.com`, retaining the local UI origin. The destination must serve personal invitations against the same database. Restart the local server or redeploy the configured preview after changing settings. See [SMS setup](sms-setup.md).
3. On a controlled team, add only the authorized test recipient, confirm permission, and send once. Check provider acceptance in the UI and Twilio, then have the recipient open the personal link, sign in, accept, reopen, and verify exactly one membership. Do not claim end-to-end delivery until receipt/acceptance is observed. No live send has been attempted for this revision. Local and Production provider settings are now configured; campaign approval and controlled live testing remain outstanding.
4. For a pending/unknown SMS, reconcile the database delivery with Twilio using its recorded provider ID when available, or recipient/time if the request timed out before an ID was returned. Keep `sending` while uncertain; only a verified outcome should change it to `sent` (with provider ID) or `failed`. Renewing links or changing batches must not be used to bypass uncertainty. Carrier delivery callbacks and an in-app reconciliation screen are not included in this revision.

### Guided setup verification — November 17, 2026

- Installed `20261117192341_guided_team_setup_details.sql` for the Back action. Its local version matches hosted history; do not reapply it. The private manager-checked implementation locks the team and updates only the group name and two configuration fields. The public wrapper is a security invoker; anonymous execution is denied. Installation does not update existing records.
- Existing data and pre-existing function fingerprints matched before and after installation. Ran the details save as an existing test team's owner in a rolled-back transaction; final fingerprints remained unchanged. PostgREST exposes the RPC and returns 401/42501 to anonymous execution. Security-advisor findings are unchanged.
- Browser regressions cover details → optional invitations → Roster, a ready shared link as the default, side-by-side email selection, reload, matching Back/Go-to-Roster sizing, skip without sending, same-team Back edits preserving concurrent roster changes/settings/link tokens, selected-recipient email completion, and staying on step two after failed/pending delivery. The signed-in local app also rendered both steps, previously saved details, conditional email fields, and the Roster destination without saving real changes or sending messages.
- Creation retries do not reset an existing shared link. If link preparation fails after creation, the saved team still opens step two and its existing Create shared team link control allows retry. Opening setup pages does not create or reactivate links.

### Scoped-edit migration verification — November 17, 2026

- Applied the reviewed `roster_first_team_management` migration with explicit user approval; hosted version `20261117181245`.
- Before/after fingerprints matched for existing profiles, groups, memberships, intended players, settings, invitations, join requests, delivery records, and all pre-existing public/private function definitions.
- The public wrapper is a security invoker, anonymous execution is denied, and the private implementation has a fixed empty search path and manager checks.
- Executed the new initialization and message-save operations as the test team's owner in a transaction, then rolled it back. Both succeeded and subsequent fingerprints confirmed no persisted data changes. The API schema exposes the RPC while denying anonymous execution.
- Security-advisor findings were unchanged. No team, membership, recipient, confirmation, or message was permanently changed during verification. PR #32's application remains unmerged and undeployed.

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

PGlite is a test-only runtime and is not added to the application dependencies. For actual lock-wait regressions, install local PostgreSQL server programs (`initdb`, `pg_ctl`, `psql`) plus Node/Python on PATH and run:

```sh
python3 scripts/test-team-onboarding-concurrency.py
```

This creates and removes its own temporary database with TCP disabled, uses no environment files or hosted credentials, and requires no Python packages. Both runners load the same migrations and canonical merge helper through `scripts/team-onboarding-test-fixture.mjs`. The fixture does not reproduce every deployed trigger/policy, so staging verification remains required.

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
