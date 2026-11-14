# Native calendar export

Single-event calendar buttons use a local `TennisCalendar` Capacitor plugin on
new iOS app binaries running iOS 17+. Apple’s `EKEventEditViewController` owns
calendar selection and saving. The app does not request calendar permission,
read calendars, or write events directly. Events are independent copies; adding
again can duplicate them and later TennisFriend changes do not synchronize.

## Integration

`TennisBridgeViewController` is the storyboard entry point and registers the
plugin only on iOS 17+. Include `TennisCalendarPlugin.swift` in the App target.
The storyboard module is `MyTennisFriends`, matching the target's product name.
No edits to the Capacitor-generated Swift package are needed.

The JS interface is `presentEvent(CalendarPayload) -> { status: 'saved' |
'cancelled' }`. Presentation errors reject the promise. Only one editor may be
active across all cards. Swift retains the call, editor, delegate, and event
store through dismissal. Native registration is the capability signal, so older
binaries loading the current website use the hosted calendar-link path.

`normalizeCalendarEvent` produces the shared Apple/ICS/Google snapshot:

- Title, notes, resolved venue/address, optional coordinates, and timezone.
- Timed events use canonical UTC ISO start/end instants.
- All-day events use `YYYY-MM-DD` dates with an exclusive end date.
- Missing timezone uses the device timezone; missing duration is 90 minutes.
- Invalid input and nonexistent DST wall times are rejected. Repeated fall-back
  wall times use the earlier occurrence. ICS bundles retain their previous
  behavior of omitting invalid entries.

Web and unsupported binaries now use hosted calendar links through the Apple
Calendar action, with an optional Download .ics alternative. Bulk actions still
label export `Export schedule (.ics)`. Google links remain available. See
[Hosted calendar links](hosted-calendar-links.md) for endpoints, privacy, and
server configuration. No schema migration is required.

## Verification

Automated checks:

```sh
npx vitest run src/lib/calendarExport.test.ts src/lib/calendarNormalization.test.ts src/lib/nativeCalendar.test.ts src/lib/wallClock.test.ts
npx tsc --noEmit
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Before release, use a synthetic event in a development/TestFlight build:

1. On a physical iOS 26 iPhone, tap Add to Apple Calendar. Confirm Apple's editor
   opens without a calendar-access permission prompt. Check title, notes, venue,
   coordinates, timed start/end, and all-day dates.
2. Cancel: verify no event is added. Reopen, save to a writable calendar, then
   inspect Apple Calendar and confirm the success announcement in TennisFriend.
3. Repeat with a device timezone different from the event timezone, a winter
   event, an all-day event spanning year-end, and an invalid/nonexistent time.
4. Double-tap and try another card while presenting. Confirm only one editor.
5. Verify a browser and an older installed binary open hosted calendar links,
   Google still opens its template, and the controls fit a 375px viewport.

A web deployment cannot install native code. Release through TestFlight and
complete physical-device checks before App Store submission. Keep capability
detection when rolling out the web changes to users with older binaries.

## Implementation verification (2026-09-07)

The targeted unit suite (57 tests), TypeScript check, targeted ESLint check,
and simulator build passed. The Next.js production build also passed, with
Sentry/OpenTelemetry bundling and stale Browserslist warnings. Browser tests at 375px confirmed ICS downloads on
web and a simulated older binary, native pending/save/cancel/error UI through a
mock bridge, no horizontal overflow, and no uncaught browser errors.
An iOS 26.5 simulator running a temporary synthetic-event harness registered the
plugin and displayed Apple's New Event editor with the expected September 26,
12:30–14:00 Seattle times and Sand Point venue, without requesting calendar
access. The harness changed only temporary build artifacts, not the production
server configuration.

Save/cancel on a physical device and TestFlight/App Store distribution remain
release gates. Simulator click automation returned `noWindowsAvailable`, so
actual native Save/Cancel completion was not verified by automation.

Sources: [Apple EventKit sample](https://developer.apple.com/documentation/eventkit/accessing-calendar-using-eventkit-and-eventkitui),
[Capacitor local plugins](https://capacitorjs.com/docs/ios/custom-code).
