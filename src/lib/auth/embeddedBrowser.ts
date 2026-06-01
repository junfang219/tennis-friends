// Detect known embedded in-app browsers from a user-agent string.
//
// Why: Google's "Use secure browsers" policy blocks OAuth (Error 403:
// disallowed_useragent) inside any WebView it considers insecure — most
// notably the in-app browsers that Instagram, Facebook, WhatsApp, etc. open
// when you tap a shared link. The page itself is on accounts.google.com, but
// Google sniffs the UA token the host app injects and rejects the request.
// We do the same sniff client-side to short-circuit before the round-trip.
//
// This is a heuristic. UAs can be spoofed and new apps appear. It's meant
// to catch the apps that cause ~95% of the support hits, not be exhaustive.
// SFSafariViewController and ASWebAuthenticationSession don't add tokens —
// they pass through, which is correct (OAuth works in those).

type EmbeddedBrowserMatch = {
  /** Pattern fragment used to detect the app — kept for tests/debug. */
  token: string;
  /** Human-readable app name for the banner copy. */
  app: string;
};

// Order matters only when an app's UA includes multiple tokens (e.g. Messenger
// includes both FBAN and FB_IAB). We return the first match, so put the more
// specific token first when it matters.
const PATTERNS: EmbeddedBrowserMatch[] = [
  { token: "FBAN", app: "Facebook" },
  { token: "FBAV", app: "Facebook" },
  { token: "FB_IAB", app: "Facebook" },
  { token: "FBIOS", app: "Facebook" },
  { token: "Instagram", app: "Instagram" },
  { token: "LinkedInApp", app: "LinkedIn" },
  { token: "MicroMessenger", app: "WeChat" },
  { token: "Line/", app: "Line" },
  { token: "BytedanceWebview", app: "TikTok" },
  { token: "musical_ly", app: "TikTok" },
  { token: "Snapchat", app: "Snapchat" },
  { token: "Pinterest", app: "Pinterest" },
  { token: "WhatsApp", app: "WhatsApp" },
  { token: "KAKAOTALK", app: "KakaoTalk" },
  // Google's own iOS app — and yes, Google blocks OAuth inside it too.
  { token: "GSA/", app: "Google app" },
];

export type EmbeddedBrowserInfo = {
  /** App name to show the user, e.g. "Instagram". */
  app: string;
};

/**
 * Return info about a known embedded in-app browser, or null for real
 * browsers / unknown UAs. Pure function — pass `navigator.userAgent`.
 */
export function detectEmbeddedBrowser(
  userAgent: string | null | undefined
): EmbeddedBrowserInfo | null {
  if (!userAgent) return null;
  for (const { token, app } of PATTERNS) {
    if (userAgent.includes(token)) return { app };
  }
  return null;
}
