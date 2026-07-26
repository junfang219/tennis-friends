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
    };

/** True for window `message` payloads sent by the injected bridge script. */
export function isBridgeMessage(data: unknown): data is BridgeMessage {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.source !== BRIDGE_SOURCE) return false;
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
