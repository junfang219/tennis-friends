// Maps Supabase auth failures to clear, user-facing messages.
//
// Two classes of failure look cryptic in the raw form Supabase/the browser
// hand us, and both showed up in testing:
//   1. Network-layer failures — the fetch never completes (offline, DNS,
//      a blocking extension/VPN, CORS). Safari/WebKit words this "Load
//      failed"; Chrome says "Failed to fetch". Neither tells the user what
//      to do.
//   2. GoTrue error codes — e.g. signing up an already-registered email
//      while confirmation is on makes GoTrue re-send a confirmation email,
//      which can trip the project's email-send rate limit (429
//      `over_email_send_rate_limit`). The raw "email rate limit exceeded"
//      reads like our bug rather than "you tried too many times".
//
// Keep this dependency-free and client-safe (no server-only imports) so it
// can be used from the login/register client components.

const FALLBACK = "Something went wrong. Please try again.";

function readProp<T>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key] as T;
  }
  return undefined;
}

export function authErrorMessage(error: unknown): string {
  // Supabase auth errors are plain objects ({ message, code, status }), not
  // Error instances — so pull `message` structurally rather than via
  // String(error), which would yield "[object Object]".
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : readProp<string>(error, "message") ?? "";

  // Network-layer failure — the request never reached Supabase.
  if (/load failed|failed to fetch|network ?error|fetch failed/i.test(raw)) {
    return "Couldn't reach the server. Check your internet connection and try again.";
  }

  const code = readProp<string>(error, "code");
  const status = readProp<number>(error, "status");

  switch (code) {
    case "invalid_credentials":
      return "Incorrect email or password.";
    case "email_not_confirmed":
      return "Please confirm your email first — check your inbox for the verification link or code.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Try logging in instead.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
    case "over_sms_send_rate_limit":
      return "Too many attempts. Please wait a minute, then try again — or log in if you already have an account.";
    case "weak_password":
      return "Please choose a stronger password (at least 8 characters).";
    case "validation_failed":
      return "Please enter a valid email address.";
  }

  if (status === 429) {
    return "Too many attempts. Please wait a minute, then try again.";
  }

  // Fall back to the server-provided message, or a generic line if there
  // wasn't one (e.g. a bare thrown value like null).
  return raw || FALLBACK;
}
