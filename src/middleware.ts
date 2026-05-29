import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./lib/database.types";

// Supabase-only session refresh middleware.
//
// Runs on every matched request — including every client-side <Link>
// navigation (the RSC fetch hits the server and passes through here). Its
// only job is to keep the auth cookie fresh so Server Components and Route
// Handlers see a valid token.
//
// Why NOT getUser(): getUser() makes a network round-trip to Supabase's
// /auth/v1/user endpoint on EVERY request to *validate* the token (~150-200ms
// measured). That latency was added to every single navigation for signed-in
// users — the dominant cause of "every tab/chat feels slow to open".
//
// We only actually need to *refresh* the token, and only near expiry. So we
// read the session from the cookie locally (getSession — no network) and call
// refreshSession() (the one network call) only inside the pre-expiry window.
// Authorization still goes through getUser()/RLS in the pages and route
// handlers themselves, so reading the cookie here without server validation
// doesn't widen any trust boundary.
//
// Critical detail: the response object MUST carry the same cookies that
// supabase wrote — otherwise the browser keeps the stale cookie.

// Refresh when the access token has this many seconds (or fewer) left, so a
// navigation never lands on an already-expired token.
const REFRESH_THRESHOLD_SECONDS = 120;

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) return response;

  const supabase = createServerClient<Database>(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          req.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Local cookie read — no network in the common (token-still-fresh) case.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (session) {
    const secondsLeft = (session.expires_at ?? 0) - Math.floor(Date.now() / 1000);
    if (secondsLeft < REFRESH_THRESHOLD_SECONDS) {
      // Token is at/near expiry — rotate it and write the new cookies onto
      // `response` via the setAll callback above. This is the only network call.
      await supabase.auth.refreshSession();
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest|robots.txt|.*\\..*).*)",
  ],
};
