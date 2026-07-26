/**
 * Parent-side protocol for the ActiveNet booking bridge.
 *
 * The /seattle proxy injects a script (bookingBridgeScript.ts) into every
 * proxied ActiveNet page. When those pages run inside the BookingSheet
 * iframe, the script postMessages navigation breadcrumbs and a
 * checkout-complete signal to the parent window. This module is the
 * parent's half: message type guard + path/JSON classifiers, kept pure so
 * they're unit-testable against captured fixtures.
 *
 * The bridge script duplicates the regex literals below (it ships as a raw
 * string into a foreign page and can't import us) — keep them in sync.
 */

export const BRIDGE_SOURCE = "tf-booking-bridge";

export type BridgeMessage =
  | { source: typeof BRIDGE_SOURCE; type: "nav"; path: string }
  | {
      source: typeof BRIDGE_SOURCE;
      type: "checkout-complete";
      path: string;
      receiptNumber?: string;
      rawSummary?: string;
    }
  // Result of the script's attempt to prefill the tapped slot into the
  // ActiveNet reservation widget. ok=false means the DOM drive gave up
  // (e.g. widget not present or aria-labels changed) and the user picks
  // manually.
  | { source: typeof BRIDGE_SOURCE; type: "prefill"; ok: boolean };

/** True for window `message` payloads sent by the injected bridge script. */
export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.source !== BRIDGE_SOURCE) return false;
  if (d.type === "prefill") return typeof d.ok === "boolean";
  if (typeof d.path !== "string") return false;
  return d.type === "nav" || d.type === "checkout-complete";
}

// Keep in sync with FUNNEL_RE / CONFIRM_RE in bookingBridgeScript.ts.
const FUNNEL_RE = /onlinecart|checkout|payment/i;
const CONFIRM_RE = /confirmation|receipt|reservation\/complete/i;

/** Did this SPA path enter the cart/checkout funnel? */
export function isCheckoutFunnelPath(path: string): boolean {
  return FUNNEL_RE.test(path);
}

/** Does this SPA path indicate a completed checkout? */
export function isConfirmationPath(path: string): boolean {
  return CONFIRM_RE.test(path);
}

/**
 * Pull a receipt number out of an ActiveNet checkout/receipt JSON response.
 * The exact field name is unverified until the discovery run captures a
 * real checkout, so this searches the object tree for the first key that
 * looks like a receipt identifier with a scalar value.
 */
export function parseReceiptFromCheckoutJson(
  json: unknown
): { receiptNumber: string } | null {
  const KEY_RE = /receipt[_-]?(number|no|num|id)|receipt[_-]?header[_-]?id/i;
  const seen = new Set<object>();
  const stack: unknown[] = [json];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== "object" || node === null) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }
    for (const [key, value] of Object.entries(node)) {
      if (
        KEY_RE.test(key) &&
        (typeof value === "string" || typeof value === "number") &&
        String(value).trim() !== "" &&
        String(value) !== "0"
      ) {
        return { receiptNumber: String(value) };
      }
      stack.push(value);
    }
  }
  return null;
}

// The two formatters below produce the exact strings ActiveNet's reservation
// widget renders, so the injected prefill routine can match its date cells and
// time-dropdown options by text. The bridge script (bookingBridgeScript.ts)
// carries byte-identical copies — it can't import this module — so these
// exported versions exist mainly to lock the format under unit tests. Keep
// the two in sync.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "17:00" → "5:00 PM", "07:30" → "7:30 AM", "00:00" → "12:00 AM". */
export function formatActiveNetClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** "2026-07-30" → "Jul 30, 2026" (matches the day-cell aria-label prefix). */
export function formatActiveNetDateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
