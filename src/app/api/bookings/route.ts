// Save a court reservation the user completed on Seattle Parks (ActiveNet)
// through the embedded booking sheet. POST-only: reads and cancels go
// through the browser client (src/lib/supabase/queries/bookings.ts) — this
// route exists so the insert can validate the window server-side.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateBookingWindow, BOOKING_TIMEZONE } from "@/lib/bookingWindow";
import { getCourtByResourceId } from "@/lib/activenetSeattleCourts";

const Body = z.object({
  resourceId: z.number().int().positive(),
  centerId: z.number().int().positive(),
  facilityId: z.string().max(64).nullish(),
  courtName: z.string().min(1).max(200),
  venueName: z.string().min(1).max(200),
  date: z.string(), // 'YYYY-MM-DD' — shape enforced by validateBookingWindow
  startTime: z.string(), // 'HH:mm'
  endTime: z.string(),
  timezone: z.string().max(64).optional(),
  confirmation: z.enum(["detected", "manual"]),
  receiptNumber: z.string().max(100).nullish(),
  activenetUrl: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    const msg =
      err instanceof z.ZodError
        ? err.issues.map((i) => i.message).join("; ")
        : "Bad request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const timezone = parsed.timezone || BOOKING_TIMEZONE;
  const window = validateBookingWindow({
    date: parsed.date,
    startTime: parsed.startTime,
    endTime: parsed.endTime,
    timezone,
  });
  if (!window.ok) {
    return NextResponse.json({ error: window.reason }, { status: 400 });
  }

  // The tapped slot came from our own catalog; a mismatch means a stale or
  // hand-crafted payload. Court names are kept as sent (they may carry the
  // user's edits), but the IDs must be internally consistent.
  const known = getCourtByResourceId(parsed.resourceId);
  if (!known || known.centerId !== parsed.centerId) {
    return NextResponse.json({ error: "Unknown court." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("court_bookings")
    .insert({
      user_id: auth.user.id,
      facility_id: parsed.facilityId ?? null,
      venue_name: parsed.venueName,
      court_name: parsed.courtName,
      center_id: parsed.centerId,
      resource_id: parsed.resourceId,
      start_time: window.start.toISOString(),
      end_time: window.end.toISOString(),
      timezone,
      confirmation: parsed.confirmation,
      receipt_number: parsed.receiptNumber ?? null,
      activenet_url: parsed.activenetUrl ?? "",
    })
    .select()
    .single();

  if (error) {
    // Unique violation on the dedupe index (same user/court/start) — the
    // booking is already saved (e.g. auto-detect fired AND the user answered
    // the manual prompt). Return the existing row as success.
    if (error.code === "23505") {
      const { data: existing } = await supabase
        .from("court_bookings")
        .select()
        .eq("resource_id", parsed.resourceId)
        .eq("start_time", window.start.toISOString())
        .neq("status", "cancelled")
        .maybeSingle();
      if (existing) {
        return NextResponse.json({ booking: existing, deduped: true });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ booking: data });
}
