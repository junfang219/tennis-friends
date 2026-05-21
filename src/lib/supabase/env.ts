// Env-var accessors.
//
// **Critical:** read each NEXT_PUBLIC_ var via the LITERAL form
// (process.env.NEXT_PUBLIC_X), not via a dynamic key lookup. Next.js /
// Webpack only inlines the literal form into client bundles at build time.
// A dynamic lookup compiles to a runtime process.env read, which is
// undefined in the browser even when the dev server has the value — that's
// how the simulator was hitting "Missing required env var" for
// NEXT_PUBLIC_SUPABASE_URL. There's a static-analysis test guarding this
// rule in env.test.ts.

function requireValue(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. See .env.example for the full list of Supabase variables.`
    );
  }
  return value;
}

export function publicSupabaseUrl(): string {
  return requireValue(process.env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
}

// Safe to expose to the browser. Modern Supabase projects use the
// publishable key format (sb_publishable_...); legacy projects use a JWT.
export function publishableKey(): string {
  return requireValue(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}

// Server-only. Modern format: sb_secret_... — bypasses RLS. Never bundle.
export function secretKey(): string {
  return requireValue(process.env.SUPABASE_SECRET_KEY, "SUPABASE_SECRET_KEY");
}
