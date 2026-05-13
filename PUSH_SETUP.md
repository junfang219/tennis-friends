# Push notifications setup (iOS APNs)

The app already has the SSE foreground stream working. Background banners on iOS
require an APNs key from your Apple Developer account plus three Xcode steps.
Without these, push is a no-op — everything else still works.

## 1. Apple Developer portal

1. Sign in at https://developer.apple.com/account.
2. **Certificates, Identifiers & Profiles → Keys → "+"**
   - Name: anything (e.g. "TennisFriend APNs").
   - Enable **Apple Push Notifications service (APNs)**.
   - Download the `AuthKey_XXXXXXXX.p8` file. **You can only download it once.**
   - Note the **Key ID** (10 chars on the key page).
3. Note your **Team ID** (top-right of the developer portal, 10 chars).
4. **Identifiers → App IDs**: confirm your Bundle ID `com.tennisfriend.app` (the
   value in `capacitor.config.ts`) has the **Push Notifications** capability
   enabled. If you registered the App ID without it, edit and re-enable.

## 2. Drop the key into the repo

```bash
mv ~/Downloads/AuthKey_XXXXXXXX.p8 ./secrets/
```

`./secrets/` is already in `.gitignore`.

## 3. Fill in `.env`

```env
APNS_KEY_PATH=./secrets/AuthKey_XXXXXXXX.p8
APNS_KEY_ID=XXXXXXXXXX        # 10 chars from the key page
APNS_TEAM_ID=YYYYYYYYYY       # 10 chars from the portal
APNS_BUNDLE_ID=com.tennisfriend.app
APNS_PRODUCTION=false         # flip to true after shipping to TestFlight / App Store
```

Restart the dev server so it picks up the env vars.

## 4. Xcode capabilities (one-time)

```bash
npx cap open ios
```

In Xcode:

1. Select the **App** target → **Signing & Capabilities** tab.
2. Click **"+ Capability"** → add **Push Notifications**.
3. Click **"+ Capability"** → add **Background Modes**, then check
   **"Remote notifications"**.
4. Make sure **Signing → Team** is set to the same Apple Developer team that
   owns the APNs key.

## 5. Run on a real device

The iOS Simulator does not deliver remote pushes. Plug in a real iPhone, select
it in the Xcode toolbar, and run. On first launch the app prompts for
notification permission; after granting, the device hits
`POST /api/devices/register` with its APNs token. You can verify in the DB:

```bash
npx prisma studio
# DeviceToken table → row with your userId + platform "ios"
```

## 6. Test the round-trip

From a different account on web:

- Send a DM → backgrounded device gets banner `"<sender>: <preview>"`.
- React ❤️ to a DM → recipient gets banner `"<actor> reacted ❤️ to your message"`.
- Tap the banner → app opens straight into `/chat/<actor>` (handled in
  `src/components/PushRegistrar.tsx`).

## Common gotchas

- **No banner appears, no error** — `APNS_PRODUCTION` mismatch. The development
  APNs sandbox (`false`) only accepts tokens from a debug build installed via
  Xcode. TestFlight / App Store builds need `APNS_PRODUCTION=true`.
- **`InvalidProviderToken`** — you set `APNS_KEY_ID` to the Bundle ID by
  mistake. The Key ID is the 10-char id from the **Keys** page, not the App ID.
- **Token shows up in DB but no banner** — make sure the iOS app target has the
  Push Notifications capability and that "Remote notifications" is checked
  under Background Modes.
- **Re-add the plugin after `git pull`** — `npx cap sync ios` re-wires native
  files; rerun whenever Capacitor plugins change.
