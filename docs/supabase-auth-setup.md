# Supabase Auth — dashboard configuration

## Status as of 2026-05-30

| Item | Status |
|---|---|
| Site URL (`https://mytennisfriends.com`) | ✅ configured |
| Redirect URLs: localhost, capacitor, mytennisfriends.com, www, `*.vercel.app` | ✅ configured |
| Email provider (confirm email on, signups on, anonymous off) | ✅ configured |
| Password hardening (HIBP + reauth + min 8 chars) | ✅ configured |
| Email rate limit | ✅ 100/h (raised from default 30/h on 2026-05-30) |
| Google OAuth | ✅ configured |
| Apple OAuth | ✅ configured (Services ID + key, JWT good until ~2026-11-28) |
| Phone OTP (Twilio) | ⏸️ deferred per user (2026-05-21) |
| Custom SMTP (Resend) | ✅ configured & domain verified, end-to-end delivery tested 2026-05-30 |

## Apple OAuth — JWT rotation

The Apple OAuth secret is a JWT signed with the Sign in with Apple key
`.p8`. Apple's max JWT lifetime is ~6 months. **The current JWT expires
around 2026-11-28.** Before then, mint a new JWT and paste it into
Supabase Auth → Providers → Apple → Secret Key.

To re-mint:

```bash
node -e "
const jwt = require('jsonwebtoken');
const fs = require('fs');
const pk = fs.readFileSync(process.env.HOME + '/Downloads/AuthKey_9YFSD8SSQR.p8', 'utf8');
const now = Math.floor(Date.now() / 1000);
console.log(jwt.sign({
  iss: 'QJ62YDMGLF',         // Team ID
  iat: now,
  exp: now + 15777000,        // ~6 months
  aud: 'https://appleid.apple.com',
  sub: 'com.tennisfriend.auth', // Services ID
}, pk, { algorithm: 'ES256', header: { alg: 'ES256', kid: '9YFSD8SSQR' } }));
"
```

The `.p8` file must remain in `~/Downloads/AuthKey_9YFSD8SSQR.p8` (or
update the path). It's the private key; Apple does not let you
re-download it. If lost, revoke the key in the Apple Developer portal
and create a new one (see §4).

---

## Reference: how it was configured (for future redos)

The TS code in `src/app/auth/*` is wired up, but a handful of provider
secrets live in the Supabase dashboard (the MCP doesn't expose them).

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

Apple Sign-In requires a Services ID + a JWT signed with a Sign In with
Apple key from the Apple Developer portal. There is no `APPLE_ID` /
`APPLE_SECRET` in `.env` yet — the docs that referenced those were
aspirational. Real steps:

**Apple Developer Portal** (https://developer.apple.com/account):
1. **Identifiers → App IDs**: create or pick the Tennis Friends App ID;
   tick **Sign In with Apple** under Capabilities.
2. **Identifiers → Services IDs**: create one (e.g.
   `com.mytennisfriends.auth`); configure Sign In with Apple with
   Primary App ID = the App ID above, Domains =
   `mytennisfriends.com,fqopzafmnaviipumsmfm.supabase.co`, Return URL =
   `https://fqopzafmnaviipumsmfm.supabase.co/auth/v1/callback`.
3. **Keys**: create a key with Sign In with Apple enabled; download the
   `.p8` immediately (one-shot download); note the Key ID and your Team
   ID (top-right of the portal).

**Supabase dashboard**
(https://supabase.com/dashboard/project/fqopzafmnaviipumsmfm/auth/providers
→ Apple):
- Enable, paste the Services ID as the Client ID.
- For Secret Key (a JWT), use Supabase's built-in JWT generator on the
  same page — paste the `.p8` contents, Team ID, Key ID, Services ID.
  The generated JWT expires every ≤6 months; calendar a reminder.

The web/Capacitor button is already wired (`onOAuth("apple")` in
`src/app/{login,register}/page.tsx`). For native iOS, swap to
`@capacitor-community/apple-sign-in` later — out of scope for the
initial wire-up.

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
