import { parsePhoneNumberFromString } from "libphonenumber-js";

export function normalizeE164(raw: string, defaultCountry: "US" = "US"): string | null {
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+\d][\d\s\-()]{6,}$/;

export function looksLikeEmail(s: string): boolean {
  return EMAIL_RE.test(s);
}

export function looksLikePhone(s: string): boolean {
  return PHONE_RE.test(s);
}
