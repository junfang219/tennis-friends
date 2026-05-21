import { createBrowserClient } from "@supabase/ssr";
import { publicSupabaseUrl, publishableKey } from "./env";
import type { Database } from "./types";

export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(publicSupabaseUrl(), publishableKey());
}
