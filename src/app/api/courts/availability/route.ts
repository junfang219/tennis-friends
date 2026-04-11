import { NextRequest, NextResponse } from "next/server";
import { fetchBookableCourts, buildBookingUrl } from "@/lib/activenet";

/**
 * GET /api/courts/availability?venueId=sea-46&date=2026-04-12
 *
 * Returns estimated availability time slots for a given venue and date,
 * based on the venue's published operating hours.
 * For real-time availability, users book directly on Seattle Parks via the popup.
 */

const BASE_URL = "https://anc.apm.activecommunities.com/seattle/rest";

interface TimeSlot {
  courtName: string;
  startTime: string; // "HH:mm"
  endTime: string;
  available: boolean;
  bookingUrl: string;
}

// Map of venue IDs to their known ActiveNet resource names
const VENUE_ACTIVENET_NAMES: Record<string, string[]> = {
  "sea-46": ["Amy Yee Tennis Center"],
  "sea-49": ["Lower Woodland"],
  "sea-22": ["Magnuson Park", "Sand Point"],
  "sea-37": ["Jefferson Park"],
  "sea-42": ["Rainier Playfield"],
  "sea-3":  ["Solstice Park"],
  "sea-24": ["Green Lake"],
  "sea-13": ["Bitter Lake"],
  "sea-31": ["Laurelhurst"],
  "sea-53": ["Meadowbrook"],
  "sea-19": ["Rainier Beach"],
  "sea-45": ["Woodland Park"],
};

// Default operating hours by venue type
function getVenueHours(venueId: string): { open: number; close: number } {
  if (venueId === "sea-46") {
    // Amy Yee Tennis Center (indoor) — longer hours
    return { open: 6, close: 22 };
  }
  // Outdoor courts
  return { open: 7, close: 21 };
}

function generateTimeSlots(
  courtName: string,
  date: string,
  openHour: number,
  closeHour: number,
  bookingUrl: string
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  for (let h = openHour; h < closeHour; h++) {
    const startTime = `${h.toString().padStart(2, "0")}:00`;
    const endTime = `${(h + 1).toString().padStart(2, "0")}:00`;
    slots.push({
      courtName,
      startTime,
      endTime,
      available: true, // Default to available; real API would check
      bookingUrl: `${bookingUrl}&date=${date}`,
    });
  }
  return slots;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const venueId = sp.get("venueId");
  const date = sp.get("date");

  if (!venueId || !date) {
    return NextResponse.json(
      { error: "venueId and date query params required" },
      { status: 400 }
    );
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD format" },
      { status: 400 }
    );
  }

  const hours = getVenueHours(venueId);
  const venueNames = VENUE_ACTIVENET_NAMES[venueId];

  // Try to get real court data from ActiveNet
  try {
    const allCourts = await fetchBookableCourts();
    const matchingCourts = venueNames
      ? allCourts.filter((c) =>
          venueNames.some(
            (vn) =>
              c.centerName.toLowerCase().includes(vn.toLowerCase()) ||
              c.name.toLowerCase().includes(vn.toLowerCase())
          )
        )
      : [];

    if (matchingCourts.length > 0) {
      // We have real court data from ActiveNet — try to get availability
      const hasApiKey = !!process.env.ACTIVENET_API_KEY;

      if (hasApiKey) {
        // Real availability from GetFacilitySchedules
        const slots = await fetchRealAvailability(
          matchingCourts.map((c) => c.id),
          date
        );
        return NextResponse.json({
          venueId,
          date,
          source: "activenet-live",
          courts: matchingCourts.map((c) => ({
            id: c.id,
            name: c.name,
            capacity: c.capacity,
          })),
          slots,
        });
      }

      // No API key — generate slots from known court data
      const slots: TimeSlot[] = [];
      for (const court of matchingCourts) {
        const url = buildBookingUrl(court.name);
        slots.push(...generateTimeSlots(court.name, date, hours.open, hours.close, url));
      }

      return NextResponse.json({
        venueId,
        date,
        source: "activenet-schedule",
        courts: matchingCourts.map((c) => ({
          id: c.id,
          name: c.name,
          capacity: c.capacity,
        })),
        slots,
        note: "Slots show operating hours. Click to check real-time availability on Seattle Parks.",
      });
    }
  } catch {
    // ActiveNet unavailable — fall through to generic slots
  }

  // Fallback: generate generic availability based on venue hours
  const bookingUrl = `https://anc.apm.activecommunities.com/seattle/reservation/search?resourceType=0&equipmentQty=0`;
  const slots = generateTimeSlots("Court", date, hours.open, hours.close, bookingUrl);

  return NextResponse.json({
    venueId,
    date,
    source: "estimated",
    courts: [],
    slots,
    note: "Estimated hours. Visit Seattle Parks to check real-time availability.",
  });
}

/**
 * Fetch real-time availability from ActiveNet's facility schedules API.
 * Requires ACTIVENET_API_KEY and ACTIVENET_SHARED_SECRET env vars.
 */
async function fetchRealAvailability(
  resourceIds: number[],
  date: string
): Promise<TimeSlot[]> {
  const apiKey = process.env.ACTIVENET_API_KEY!;
  const orgId = process.env.ACTIVENET_ORG_ID || "seattle";

  const body = {
    facility_ids: resourceIds,
    date_from: date,
    date_to: date,
    page_size: 200,
    start_index: 0,
  };

  const res = await fetch(
    `${BASE_URL}/reservation/resource/timeslots?locale=en-US&api_key=${encodeURIComponent(apiKey)}&org_id=${encodeURIComponent(orgId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) throw new Error(`ActiveNet timeslots API: ${res.status}`);
  const json = await res.json();

  if (json.headers?.response_code !== "0000") {
    throw new Error(`ActiveNet error: ${json.headers?.response_message}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: any[] = json.body?.time_slots || [];
  return items.map((slot) => ({
    courtName: slot.facility_name || "Court",
    startTime: slot.start_time || "",
    endTime: slot.end_time || "",
    available: slot.status === "available",
    bookingUrl: slot.booking_url || buildBookingUrl(slot.facility_name || ""),
  }));
}
