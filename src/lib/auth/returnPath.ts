import { z } from "zod";

// A single leading slash keeps navigation on this origin. Browsers can
// normalize backslashes and strip tabs or newlines when parsing a URL.
const authReturnPath = z.string().regex(/^\/(?!\/)[^\\\t\r\n]*$/).catch("/");

export function safeAuthReturnPath(value: string | null): string {
  return authReturnPath.parse(value);
}
