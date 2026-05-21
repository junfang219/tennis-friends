// Sentry instrumentation hook for Next.js.
//
// Loaded automatically by Next.js if the file exists. Initializes the SDK
// once per server runtime; the matching sentry.client.config.ts handles
// the browser bundle.
//
// Activation: set NEXT_PUBLIC_SENTRY_DSN (or SENTRY_DSN for server-only
// reporting). If unset, Sentry initialization is skipped silently — fine
// for dev. Production must set a DSN before launch.

import * as Sentry from "@sentry/nextjs";

export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
  if (!dsn) return;

  const environment =
    process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
  const tracesSampleRate = parseFloat(
    process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"
  );

  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({ dsn, environment, tracesSampleRate });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({ dsn, environment, tracesSampleRate });
  }
}

// Re-export for use in custom error boundaries / route handlers that want
// to capture exceptions manually: `import { captureException } from "@/instrumentation"`.
export const captureException = Sentry.captureException;
export const captureMessage = Sentry.captureMessage;
