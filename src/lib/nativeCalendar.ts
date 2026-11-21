import { Capacitor, registerPlugin } from "@capacitor/core";
import { z } from "zod";
import { calendarPayloadSchema, normalizeCalendarEvent, type CalendarPayload, type ExportEvent } from "./calendarExport";

import { createCalendarLink } from "./calendarLinks";

interface TennisCalendarPlugin {
  presentEvent(event: CalendarPayload): Promise<{ status: "saved" | "cancelled" }>;
}
const TennisCalendar = registerPlugin<TennisCalendarPlugin>("TennisCalendar");
const resultSchema = z.object({ status: z.enum(["saved", "cancelled"]) });

// Swift registers the plugin only on iOS 17+. Old installed binaries never
// advertise it, even when they load the latest deployed web bundle.
export function hasNativeCalendar(): boolean {
  return Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("TennisCalendar");
}

let presenting = false;
export async function addToCalendar(event: ExportEvent, guestToken?: string): Promise<"saved" | "cancelled" | "opened"> {
  if (presenting) throw new Error("A calendar editor is already open.");
  const payload = calendarPayloadSchema.parse(normalizeCalendarEvent(event));
  if (!hasNativeCalendar()) {
    const link = await createCalendarLink(event, guestToken);
    window.location.assign(link.url);
    return "opened";
  }
  presenting = true;
  try {
    return resultSchema.parse(await TennisCalendar.presentEvent(payload)).status;
  } finally {
    presenting = false;
  }
}
