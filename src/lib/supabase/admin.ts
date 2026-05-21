import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseUrl, secretKey } from "./env";
import type { Database } from "./types";

// Bypasses RLS. Use only in Route Handlers, Edge Functions, cron jobs, and
// webhooks where elevated access is intentional. Never expose to the browser.
// Modern Supabase key format: sb_secret_... (replaces the legacy service_role JWT).
export function createSupabaseAdminClient() {
  return createClient<Database>(publicSupabaseUrl(), secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
