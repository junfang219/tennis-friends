import { openCalendarLink, CalendarLinkConfigurationError, CalendarLinkExpiredError } from "@/lib/calendarLinkToken";
import { buildCalendarPayloadIcs } from "@/lib/calendarExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const snapshot = openCalendarLink(token);
    return new Response(buildCalendarPayloadIcs(snapshot.id, snapshot.payload, new Date(snapshot.issuedAt)), {
      headers: { ...headers,
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="tennis-event.ics"',
      },
    });
  } catch (error) {
    const expired = error instanceof CalendarLinkExpiredError;
    const unavailable = error instanceof CalendarLinkConfigurationError;
    return new Response(expired ? "This calendar link has expired. Ask the sender for a new link." : "Calendar link unavailable.", {
      status: unavailable ? 503 : expired ? 410 : 404,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
