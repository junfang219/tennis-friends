"use client";

import TeamCalendarSubscription from "./TeamCalendarSubscription";
import { useEffect, useRef, useState } from "react";
import { buildGoogleCalendarUrl, downloadIcs, type ExportEvent } from "@/lib/calendarExport";
import { addToCalendar, hasNativeCalendar } from "@/lib/nativeCalendar";

import { createCalendarLink, type CalendarLink } from "@/lib/calendarLinks";

/** Shared by event cards and RSVP pages; actions must not open the parent card. */
export default function CalendarExportButtons(props: { event: ExportEvent; guestToken?: string; teamId?: string }) {
  if (props.teamId) return <TeamCalendarSubscription teamId={props.teamId} guestToken={props.guestToken} />;
  return <SingleEventCalendarButtons {...props} />;
}

function SingleEventCalendarButtons({ event, guestToken }: { event: ExportEvent; guestToken?: string }) {
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<CalendarLink | null>(null);
  const active = useRef(false);
  useEffect(() => { setNative(hasNativeCalendar()); }, []);

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold text-gray-600 uppercase tracking-wide">Add to calendar</span>
        <button
          type="button"
          disabled={busy}
          onClick={async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (active.current) return;
            active.current = true;
            setBusy(true); setMessage("");
            try {
              const status = await addToCalendar(event, guestToken);
              setMessage(status === "saved" ? "Added to your calendar. This copy won’t update automatically." : "");
            } catch (error) {
              setMessage(error instanceof Error && !error.name.includes("Zod") ? error.message : "Check the event date and time, then try again.");
            } finally {
              active.current = false;
              setBusy(false);
            }
          }}
          className="text-xs font-semibold px-2.5 py-2 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60 transition-colors"
        >
          {busy ? "Opening calendar…" : native ? "Add to Apple Calendar" : "Apple Calendar"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={(e) => {
            e.preventDefault(); e.stopPropagation();
            try {
              window.open(buildGoogleCalendarUrl(event), "_blank", "noopener,noreferrer");
              setMessage("");
            } catch {
              setMessage("Couldn’t add this event. Check its date and time, then try again.");
            }
          }}
          className="text-xs font-semibold px-2.5 py-2 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-60 transition-colors"
        >Google</button>
        <button
          type="button" disabled={busy}
          className="text-xs font-semibold px-2.5 py-2 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-60"
          onClick={async (e) => {
            e.preventDefault(); e.stopPropagation();
            if (active.current) return;
            active.current = true; setBusy(true); setMessage("");
            try {
              // Mint from the current card each time so an edit never shares a stale snapshot.
              const created = await createCalendarLink(event, guestToken);
              setLink(created);
              try {
                await navigator.clipboard.writeText(created.url);
                setMessage("Calendar link copied. Paste it into iMessage.");
              } catch {
                setMessage("Your calendar link is ready. Copy it from the field below.");
              }
            } catch (error) {
              setMessage(error instanceof Error && !error.name.includes("Zod") ? error.message : "Check the event date and time, then try again.");
            } finally { active.current = false; setBusy(false); }
          }}
        >Copy calendar link</button>
        <button type="button" disabled={busy}
          className="text-xs text-gray-600 underline px-1 py-2"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadIcs(event); }}
        >Download .ics</button>
      </div>
      <p className="text-xs text-gray-600 mt-2">Calendar links share an event copy with anyone who has the link for 30 days.</p>
      {link && (
        <div className="mt-2 space-y-1" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <label className="block text-xs font-semibold text-gray-700">
            Calendar link
            <input aria-label="Calendar link" readOnly value={link.url}
              onFocus={(e) => e.target.select()}
              className="mt-1 w-full min-w-0 rounded border border-gray-300 bg-white p-2 text-xs font-normal" />
          </label>
          <button type="button" className="text-xs text-blue-700 underline"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.assign(link.url); }}
          >Open calendar link</button>
          <p className="text-xs text-gray-600">Expires {new Date(link.expiresAt).toLocaleDateString()}.</p>
        </div>
      )}
      <p role="status" aria-live="polite" className="text-xs text-gray-700 mt-1">{message}</p>
    </div>
  );
}
