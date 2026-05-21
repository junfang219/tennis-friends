# Supabase Auth — dashboard configuration

The TS code in `src/app/auth/*` is wired up, but a handful of provider
secrets live in the Supabase dashboard (the MCP doesn't expose them).
Take these in order before the auth cutover in Phase 5.

## 1. Site URL + redirect allowlist

https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/auth/url-configuration

- **Site URL:** `http://localhost:3000` for dev, your real domain for prod.
- **Redirect URLs:** add every callback path the app uses:
  - `http://localhost:3000/auth/callback`
  - `https://<your-domain>/auth/callback`
  - `capacitor://localhost/auth/callback` (Capacitor iOS app)

Supabase rejects any OAuth/magic-link return URL not on this list.

## 2. Email provider (built-in)

https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/auth/providers

- **Enable Email provider**
- **Confirm email:** ON (recommended). Users will get a confirmation
  link before their first sign-in. The `/auth/callback` route handles it.
- **Secure email change:** ON
- **Email templates:** the defaults work; customize copy under
  `Auth → Email Templates` if you want branded mail.

> The free SMTP is fine for dev. For production volume swap to your own
> SMTP (Resend, SendGrid) under `Auth → SMTP Settings`.

## 3. Google OAuth

https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/auth/providers
Toggle **Google** on, then paste:

- `Client ID` = the existing `GOOGLE_CLIENT_ID` from `.env`
- `Client Secret` = the existing `GOOGLE_CLIENT_SECRET` from `.env`
- Authorized redirect URI shown by Supabase looks like
  `https://fqopzafmnaviipumsmfm.supabase.co/auth/v1/callback`. Add it to
  your Google Cloud Console OAuth client's Authorized redirect URIs.

## 4. Apple OAuth

Same provider page → enable **Apple**.

- `Services ID` = existing `APPLE_ID` from `.env`
- `Secret Key` = existing `APPLE_SECRET` (the pre-minted JWT)
- Add the Supabase callback URL to your Apple Services ID's "Return URLs".

## 5. Phone OTP (Twilio Verify)

https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/auth/providers
→ **Phone** → enable, select Twilio.

- Account SID = `TWILIO_ACCOUNT_SID`
- Auth Token = `TWILIO_AUTH_TOKEN`
- Verify Service SID = `TWILIO_VERIFY_SERVICE_SID`

The legacy `"000000"` dev fallback is gone — phone-auth dev now requires
real Twilio credentials. Document this in onboarding so contributors know.

## 6. Disable signups (optional, pre-launch)

If you want to lock signups during dev:
https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/auth/providers
→ scroll to **User signups** → toggle **Allow new users to sign up** off.

You can still create users manually via the dashboard `Users` page or the
MCP `auth.admin.createUser` flow.

## 7. Verify

After setup, run the integration tests:

```bash
npm run test:integration
```

The RLS test suite (`tests/integration/rls-policies.test.ts`) creates
test users via the admin API and signs them in with password — that
exercises the email/password provider end-to-end. If it stays green
after dashboard changes, the provider config is healthy.
