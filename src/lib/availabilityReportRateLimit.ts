import type { NextRequest } from "next/server";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP = 10;

const timestamps = new Map<string, number[]>();

export function ipFor(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

export function checkAvailabilityReportRateLimit(
  ip: string
): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const fresh = (timestamps.get(ip) ?? []).filter((t) => t > cutoff);
  if (fresh.length >= MAX_PER_IP) {
    const oldest = fresh[0];
    return {
      ok: false,
      retryAfterSec: Math.ceil((oldest + WINDOW_MS - now) / 1000),
    };
  }
  fresh.push(now);
  timestamps.set(ip, fresh);
  return { ok: true, retryAfterSec: 0 };
}
