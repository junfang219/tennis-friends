import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// OAuth and email-confirmation flows redirect here. Supabase appended a
// `code` (PKCE) or a session in the URL hash; we swap it for a real session
// and redirect to the intended page.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const requestedNext = url.searchParams.get("next") ?? "/";
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") && !requestedNext.includes("\\") ? requestedNext : "/";
  // Next dev may internally use localhost even when the browser used 127.0.0.1.
  // Keep the browser's loopback host so PKCE/session cookies stay on one origin.
  const host = request.headers.get("host");
  const origin = process.env.NODE_ENV === "development" && host && /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
    ? `${url.protocol}//${host}` : url.origin;

  // OAuth can't tell us up front whether this is a brand-new account or a
  // returning user — both arrive through signInWithOAuth. So the page-supplied
  // `next` (e.g. /onboarding from the register button) is only a hint. Once we
  // have a session we route by the profile's onboarding state, so an existing
  // Google user isn't dumped back into "Tell us about your game".
  let dest = next;

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      const retry = new URL("/login", origin);
      retry.searchParams.set("error", "Sign-in could not reach the authentication service. Please try again.");
      retry.searchParams.set("next", next);
      return NextResponse.redirect(retry);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_complete")
        .eq("id", user.id)
        .maybeSingle();

      if (!profile?.onboarding_complete) {
        // New or half-finished account — always send them through onboarding.
        // Preserve the original `next` so onboarding can land them there
        // afterward (e.g. a public /p/[id] share link that triggered signup).
        dest =
          next && next !== "/onboarding"
            ? `/onboarding?next=${encodeURIComponent(next)}`
            : "/onboarding";
      } else if (dest === "/onboarding") {
        // Returning user who happened to come in via the register button —
        // send them home instead of re-running onboarding.
        dest = "/";
      }
    }
  }

  return NextResponse.redirect(new URL(dest, origin));
}
