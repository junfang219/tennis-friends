import type { NextRequest } from "next/server";

/**
 * Shared rate-limit + IP helpers for the /api/report-* endpoints.
 *
 * The in-memory Map is module-scoped, so all report endpoints share one
 * counter per IP. A user can't dodge the cap by alternating between
 * "report an issue" and "report a missing court".
 *
 * Single-process only; resets on dev server restart. For multi-instance
 * production, swap for Redis or a managed limiter.
 */

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

const reportTimestamps = new Map<string, number[]>();

export function ipFor(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

export function checkRateLimit(ip: string): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const fresh = (reportTimestamps.get(ip) ?? []).filter((t) => t > cutoff);
  if (fresh.length >= RATE_LIMIT_MAX) {
    const oldest = fresh[0];
    return {
      ok: false,
      retryAfterSec: Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000),
    };
  }
  fresh.push(now);
  reportTimestamps.set(ip, fresh);
  return { ok: true, retryAfterSec: 0 };
}

export function isPlausibleEmail(s: string): boolean {
  // Cheap shape check; not a full RFC validator.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
