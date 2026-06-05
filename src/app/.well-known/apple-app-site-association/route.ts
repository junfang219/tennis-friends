import { NextResponse } from "next/server";

// Apple Universal Links — served from
// https://mytennisfriends.com/.well-known/apple-app-site-association
//
// iOS fetches this file once on app install / app update (and occasionally on
// refresh) to learn which paths on the domain belong to our app. When a user
// taps a matching link (e.g. an LFP share `/p/<id>` in iMessage), iOS opens
// the Tennis Friends app instead of Safari and delivers the URL via the
// Capacitor `appUrlOpen` event (see AppUrlOpenListener).
//
// Requirements iOS enforces on this response:
//  - HTTPS, status 200, no redirects, no auth wall.
//  - Content-Type `application/json` (NOT `application/pkcs7-mime` since iOS 9).
//  - The `appIDs` entry must be `<TEAM_ID>.<BUNDLE_ID>`.
//
// Only `/p/*` and `/club-invite/*` are claimed — every other path stays in
// the browser, which keeps pages like /login, /onboarding, /chat reachable
// from email links etc.
const AASA = {
  applinks: {
    details: [
      {
        appIDs: ["QJ62YDMGLF.com.tennisfriend.app"],
        components: [
          {
            "/": "/p/*",
            comment: "Public LFP post preview — open in app when installed",
          },
          {
            "/": "/club-invite/*",
            comment: "Club QR invite — open in app when installed so a member who scans lands in the club chat",
          },
        ],
      },
    ],
  },
};

export async function GET() {
  return NextResponse.json(AASA, {
    headers: {
      "Content-Type": "application/json",
      // Don't let edges or browsers cache a stale answer for long — keeps the
      // file responsive if we later add more paths or rotate the appID.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
