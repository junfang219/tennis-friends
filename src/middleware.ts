import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getToken } from "next-auth/jwt";
import type { Database } from "./lib/database.types";

// Two responsibilities during the NextAuth → Supabase Auth transition:
//   1. Refresh the Supabase session cookie so getUser() in Server Components
//      reads a current token. Required for any Supabase Auth flow to work.
//   2. Preserve the legacy NextAuth onboarding redirect so the existing app
//      keeps functioning until the Phase 5 cutover removes NextAuth.
//
// Phase 5 cleanup: delete the NextAuth branch and rename callers to use the
// Supabase user directly.

const PUBLIC_PATHS = ["/login", "/register", "/onboarding"];

export async function middleware(req: NextRequest) {
  const response = NextResponse.next({ request: req });

  // --- Supabase session refresh ---
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (supabaseUrl && supabaseKey) {
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
    // Forces a token refresh if needed; writes new cookies onto `response`.
    await supabase.auth.getUser();
  }

  // --- Legacy NextAuth onboarding redirect ---
  const { pathname } = req.nextUrl;
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token) {
    const onboardingComplete = Boolean(
      (token as { onboardingComplete?: boolean }).onboardingComplete
    );
    if (
      !onboardingComplete &&
      !PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
    ) {
      const url = req.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api/auth|api/onboarding|_next/static|_next/image|favicon.ico|icons|manifest|robots.txt|.*\\..*).*)",
  ],
};
