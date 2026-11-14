import { z } from "zod";
import { calendarPayloadSchema, normalizeCalendarEvent, type ExportEvent } from "./calendarExport";

export const calendarLinkRequestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/),
  payload: calendarPayloadSchema,
  guestToken: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional(),
});
const responseSchema = z.object({
  path: z.string().regex(/^\/calendar\/shared\/[A-Za-z0-9_-]+\/event\.ics$/),
  expiresAt: z.iso.datetime(),
  baseUrl: z.string().url().refine((value) => new URL(value).protocol === "https:").optional(),
});
export type CalendarLink = { url: string; expiresAt: string };

export async function createCalendarLink(event: ExportEvent, guestToken?: string): Promise<CalendarLink> {
  const body = calendarLinkRequestSchema.parse({ id: event.id, payload: normalizeCalendarEvent(event), guestToken });
  const response = await fetch("/api/calendar/links", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Sign in again to create a calendar link.");
    if (response.status === 503) throw new Error("Calendar links aren’t configured on this server yet.");
    if (response.status === 413) throw new Error("This event has too much text to share as a calendar link.");
    throw new Error("Couldn’t create the calendar link. Please try again.");
  }
  const result = responseSchema.parse(await response.json());
  return { url: new URL(result.path, result.baseUrl ?? window.location.origin).href, expiresAt: result.expiresAt };
}
