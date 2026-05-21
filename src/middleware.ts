import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./lib/database.types";

// Supabase-only session refresh middleware.
//
// Runs on every matched request. Reads the auth cookie, asks Supabase to
// refresh the access token if needed, and writes the new cookie back so
// Server Components and Route Handlers can call `supabase.auth.getUser()`
// without each one having to refresh itself.
//
// Critical detail: the response object MUST carry the same cookies that
// supabase wrote — otherwise the browser keeps the stale cookie.

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

  // Forces a token refresh if needed; writes new cookies onto `response`.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons|manifest|robots.txt|.*\\..*).*)",
  ],
};
