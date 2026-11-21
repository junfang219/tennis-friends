import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { calendarLinkRequestSchema } from "@/lib/calendarLinks";
import { sealCalendarLink, calendarLinkBaseUrl, CalendarLinkConfigurationError, CalendarLinkSizeError } from "@/lib/calendarLinkToken";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const json = (body: object, status = 200) => Response.json(body, { status, headers });
const guestViewSchema = z.object({
  matches: z.array(z.object({ id: z.string() })),
  practices: z.array(z.object({ id: z.string() })),
});

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Invalid origin" }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ error: "Expected JSON" }, 415);
  // Bound the body while reading, including clients without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Missing event" }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return json({ error: "Event too large" }, 413); }
      chunks.push(value);
    }
    const parsed = calendarLinkRequestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) return json({ error: "Invalid event" }, 400);
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (!parsed.data.guestToken) return json({ error: "Sign in required" }, 401);
      // Preserve the existing public RSVP flow without putting its roster
      // capability into the calendar URL or using an admin database client.
      const { data, error } = await supabase.rpc("guest_roster_view", { p_token: parsed.data.guestToken });
      const view = guestViewSchema.safeParse(data);
      if (error || !view.success || ![
        ...view.data.matches.map((event) => `match-${event.id}`),
        ...view.data.practices.map((event) => `practice-${event.id}`),
      ].includes(parsed.data.id)) return json({ error: "Invalid RSVP access" }, 403);
    }
    return json({ ...sealCalendarLink(parsed.data), baseUrl: calendarLinkBaseUrl() });
  } catch (error) {
    if (error instanceof CalendarLinkConfigurationError) return json({ error: "Calendar links are not configured" }, 503);
    if (error instanceof CalendarLinkSizeError) return json({ error: "Event too large" }, 413);
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON" }, 400);
    return json({ error: "Could not create calendar link" }, 500);
  }
}
