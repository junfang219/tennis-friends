"use client";

import { useRef, useState } from "react";
import { createTeamCalendarLink, buildGoogleTeamCalendarUrl } from "@/lib/teamCalendar";

export default function TeamCalendarSubscription({ teamId, guestToken }: {
  teamId: string; guestToken?: string;
}) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");
  const [google, setGoogle] = useState(false);
  async function prepare(action: "subscribe" | "copy" | "google") {
    if (active.current) return;
    active.current = true; setBusy(true); setMessage("");
    try {
      const link = await createTeamCalendarLink(teamId, guestToken);
      setUrl(link);
      setGoogle(action === "google");
      if (action === "google") {
        setMessage("Your whole team schedule is ready. Continue to Google Calendar on a computer to subscribe.");
      } else if (action === "copy") {
        try {
          await navigator.clipboard.writeText(link);
          setMessage("Team calendar link copied. Subscribe once for all this team’s matches.");
        } catch { setMessage("Copy the team calendar link from the field below."); }
      } else { window.location.assign(link); }
    } catch (error) {
      setMessage(error instanceof Error && !error.name.includes("Zod") ? error.message : "Couldn’t open this team calendar. Please try again.");
    } finally { active.current = false; setBusy(false); }
  }
  return (
    <div className="mt-3 border-t border-gray-100 pt-3" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void prepare("subscribe")}
          className="rounded-full bg-gray-100 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-60">
          {busy ? "Preparing calendar…" : "Subscribe to team matches"}
        </button>
        <button type="button" disabled={busy} onClick={() => void prepare("copy")}
          className="rounded-full bg-gray-100 px-2.5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-60">
          Copy team calendar link
        </button>
        <button type="button" disabled={busy}
          className="rounded-full bg-blue-50 px-2.5 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60"
          onClick={() => void prepare("google")}>Google Calendar — team matches</button>
      </div>
      <p className="mt-2 text-xs text-gray-600">Subscribe once for all this team’s scheduled matches. Changes appear when Calendar refreshes.</p>
      {url && <label className="mt-2 block text-xs font-semibold text-gray-700">
        Team calendar link
        <input aria-label="Team calendar link" readOnly value={url} onFocus={(e) => e.target.select()}
          className="mt-1 w-full min-w-0 rounded border border-gray-300 bg-white p-2 text-xs font-normal" />
      </label>}
      {google && url && <div className="mt-2 space-y-2 text-xs text-gray-700">
        <button type="button" className="rounded-full bg-blue-50 px-2.5 py-2 font-semibold text-blue-700 hover:bg-blue-100"
          onClick={() => window.open(buildGoogleTeamCalendarUrl(url), "_blank", "noopener,noreferrer")}>Continue to Google Calendar</button>
        <p>Use Google Calendar’s website on a computer to add this subscription. It will then appear in the mobile app for the same Google account.</p>
        <p>If the calendar isn’t offered automatically, copy the team link above. In Google Calendar, choose Other calendars → + → From URL, paste it, and choose Add calendar.</p>
        <p>All this team’s matches share one calendar. Google controls how often schedule updates appear.</p>
      </div>}
      <p className="mt-1 text-xs text-gray-600">Anyone with this link can view this team’s match schedule, including future updates.</p>
      <p role="status" aria-live="polite" className="mt-1 text-xs text-gray-700">{message}</p>
    </div>
  );
}
