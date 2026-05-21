function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. See .env.example for the full list of Supabase variables.`
    );
  }
  return value;
}

export function publicSupabaseUrl(): string {
  return required("NEXT_PUBLIC_SUPABASE_URL");
}

// Safe to expose to the browser. Modern Supabase projects use the
// publishable key format (sb_publishable_...); legacy projects use a JWT.
export function publishableKey(): string {
  return required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

// Server-only. Modern format: sb_secret_... — bypasses RLS. Never bundle.
export function secretKey(): string {
  return required("SUPABASE_SECRET_KEY");
}
