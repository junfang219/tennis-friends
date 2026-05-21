import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicSupabaseUrl, publishableKey } from "./env";
import type { Database } from "./types";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(publicSupabaseUrl(), publishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll is a no-op when called from a Server Component;
          // middleware refreshes the session cookie on every request.
        }
      },
    },
  });
}
