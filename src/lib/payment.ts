export type PaymentMethod = "venmo" | "paypal" | "cashapp" | "zelle";

export type PaymentHandles = {
  venmoHandle: string | null;
  paypalHandle: string | null;
  cashappHandle: string | null;
  zelleHandle: string | null;
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  venmo: "Venmo",
  paypal: "PayPal",
  cashapp: "Cash App",
  zelle: "Zelle",
};

const ORDER: PaymentMethod[] = ["venmo", "paypal", "cashapp", "zelle"];

export function preferredHandle(
  user: PaymentHandles
): { method: PaymentMethod; handle: string } | null {
  for (const method of ORDER) {
    const handle = user[`${method}Handle` as const];
    if (handle && handle.trim()) return { method, handle: handle.trim() };
  }
  return null;
}

export function dollarsString(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  const abs = Math.abs(amountCents);
  return `${sign}${(abs / 100).toFixed(2)}`;
}

export function splitEqualCents(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const remainder = totalCents - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

export type PayIntent = {
  method: PaymentMethod;
  handle: string;
  amountCents: number;
  note: string;
  appUrl: string | null;
  webUrl: string | null;
  copyText: string | null;
};

export function buildPayIntent(
  method: PaymentMethod,
  handle: string,
  amountCents: number,
  note: string
): PayIntent {
  const dollars = (amountCents / 100).toFixed(2);
  // Whole-dollar amounts: omit ".00" — some payment providers (notably Cash App)
  // are stricter about path-based amount parsing.
  const dollarsCompact = amountCents % 100 === 0 ? String(amountCents / 100) : dollars;
  const encodedNote = encodeURIComponent(note);
  // Strip any leading "@", "$", or whitespace so a handle pasted as "$jane",
  // "@jane", or "  jane" all normalize to "jane".
  const stripped = handle.replace(/^[@$\s]+/, "").trim();
  const safeHandle = encodeURIComponent(stripped);

  let appUrl: string | null = null;
  let webUrl: string | null = null;
  let copyText: string | null = null;

  switch (method) {
    case "venmo":
      // Canonical Venmo deep link: app scheme launches the iOS/Android Venmo app
      // directly to the compose-payment screen; the web URL opens the same form
      // on venmo.com (root path, recipient + amount as query params).
      appUrl = `venmo://paycharge?txn=pay&recipients=${safeHandle}&amount=${dollars}&note=${encodedNote}`;
      webUrl = `https://venmo.com/?txn=pay&audience=public&recipients=${safeHandle}&amount=${dollars}&note=${encodedNote}`;
      break;
    case "paypal":
      // PayPal.me — works as Universal Link on iOS; falls back to web on desktop.
      webUrl = `https://paypal.me/${safeHandle}/${dollarsCompact}`;
      break;
    case "cashapp":
      // Cash App Universal Link. If the cashtag is invalid or the page rejects
      // the amount path, also expose copyText so the UI can fall back to a
      // copy-cashtag button.
      webUrl = `https://cash.app/$${safeHandle}/${dollarsCompact}`;
      copyText = `$${stripped}`;
      break;
    case "zelle":
      copyText = stripped;
      break;
  }

  return { method, handle: stripped, amountCents, note, appUrl, webUrl, copyText };
}
