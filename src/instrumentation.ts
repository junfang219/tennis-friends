// Sentry instrumentation hook for Next.js.
//
// Loaded automatically by Next.js if the file exists. Initializes the SDK
// once per server runtime and once on the client (via the matching
// sentry.client.config.ts when DSN is set).
//
// Activation: set NEXT_PUBLIC_SENTRY_DSN. If unset, Sentry initialization
// is skipped silently — fine for dev. Production must set a DSN before launch.

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    // @ts-expect-error - dynamic dep, install with `npm install @sentry/nextjs` to activate.
    const Sentry = await import("@sentry/nextjs").catch(() => null);
    if (!Sentry) return;
    Sentry.init({
      dsn,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    // @ts-expect-error - dynamic dep, install with `npm install @sentry/nextjs` to activate.
    const Sentry = await import("@sentry/nextjs").catch(() => null);
    if (!Sentry) return;
    Sentry.init({
      dsn,
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    });
  }
}
