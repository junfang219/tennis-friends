"use client";

import { buildGoogleCalendarUrl, downloadIcs, type ExportEvent } from "@/lib/calendarExport";

/** Apple/.ics + Google "Add to calendar" buttons, shared by every card.
 *  preventDefault/stopPropagation so it works inside a Link or a clickable
 *  card without triggering the card's own navigation/edit. */
export default function CalendarExportButtons({ event }: { event: ExportEvent }) {
  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Add to calendar</span>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadIcs(event); }}
        className="text-xs font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
      >
        Apple / .ics
      </button>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(buildGoogleCalendarUrl(event), "_blank", "noopener,noreferrer");
        }}
        className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
      >
        Google
      </button>
    </div>
  );
}
