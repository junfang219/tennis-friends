import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { publicSupabaseUrl, publishableKey } from "./env";
import type { Database } from "./types";

// Single shared browser client.
//
// createBrowserClient() builds a GoTrueClient with its own autoRefreshToken
// timer and its own in-memory copy of the session. This helper has ~70 call
// sites, and previously each call created a fresh client — so many timers were
// independently refreshing the same cookie-backed session. In a Capacitor
// WebView that resumes from background, those racing refreshes can rotate the
// refresh token out from under each other and trip Supabase's
// refresh-token-reuse detection, which revokes the whole session and logs the
// user out. Memoizing to a single instance gives one refresh authority on the
// client (the SSR middleware remains the server-side authority).
let browserClient: SupabaseClient<Database> | null = null;

function newClient(): SupabaseClient<Database> {
  return createBrowserClient<Database>(publicSupabaseUrl(), publishableKey(), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export function createSupabaseBrowserClient(): SupabaseClient<Database> {
  // On the server (SSR / RSC) there is no window to scope a singleton to, and
  // each render should get its own client — never cache there.
  if (typeof window === "undefined") return newClient();
  if (!browserClient) browserClient = newClient();
  return browserClient;
}
