"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  createPersonalEvent,
  updatePersonalEvent,
  deletePersonalEvent,
  type PersonalEvent,
} from "@/lib/supabase/queries";
import { computeCourtFacilityId } from "@/lib/facilities";
import CourtLocationPicker from "@/components/CourtLocationPicker";
import { errorMessage } from "@/lib/errorMessage";

type Props = {
  /** When set, the modal edits this event; otherwise it creates a new one. */
  existing?: PersonalEvent | null;
  /** Pre-selected date (YYYY-MM-DD) for a new event. */
  defaultDate?: string | null;
  onClose: () => void;
  /** Called after a successful create/update/delete so the caller can refetch. */
  onSaved: () => void;
};

const MAX_TITLE = 120;
const MAX_NOTES = 1000;

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Los_Angeles";
  } catch {
    return "America/Los_Angeles";
  }
}

export function PersonalEventModal({ existing, defaultDate, onClose, onSaved }: Props) {
  const editing = !!existing;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [date, setDate] = useState(existing?.event_date ?? defaultDate ?? "");
  const [time, setTime] = useState(existing?.event_time ?? "");
  const [duration, setDuration] = useState(
    existing?.duration_minutes != null ? String(existing.duration_minutes) : ""
  );
  const [location, setLocation] = useState(existing?.location ?? "");
  // Catalog court id when the location was picked from the typeahead; null for
  // free text. Resolved one last time on save (matches PostComposer).
  const [locationFacilityId, setLocationFacilityId] = useState<string | null>(
    existing?.court_facility_id ?? null
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const canSave = !saving && !deleting && title.trim().length > 0 && !!date;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const durationMinutes = duration.trim() ? parseInt(duration, 10) : null;
    const input = {
      title,
      eventDate: date,
      eventTime: time,
      durationMinutes:
        durationMinutes != null && Number.isFinite(durationMinutes) && durationMinutes > 0
          ? durationMinutes
          : null,
      location,
      // Free text that still matches a known court reattaches its id here.
      courtFacilityId: computeCourtFacilityId(location, locationFacilityId),
      notes,
      timezone: browserTimezone(),
    };
    try {
      const supabase = createSupabaseBrowserClient();
      if (editing && existing) {
        await updatePersonalEvent(supabase, existing.id, input);
      } else {
        await createPersonalEvent(supabase, input);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't save the event."));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setDeleting(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await deletePersonalEvent(supabase, existing.id);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't delete the event."));
      setDeleting(false);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[600] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="personal-event-title"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h3 id="personal-event-title" className="font-semibold text-gray-900 text-sm">
            {editing ? "Edit event" : "Add event"}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3 overflow-y-auto space-y-3">
          <Field label="Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
              placeholder="e.g. Lesson with coach, League night"
              autoFocus
              className={inputCls}
            />
          </Field>

          <div className="flex gap-2">
            <Field label="Date" className="flex-1">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Time" className="w-28">
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Mins" className="w-20">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="60"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Location">
            <CourtLocationPicker
              value={location}
              facilityId={locationFacilityId}
              onChange={(text, id) => {
                setLocation(text);
                setLocationFacilityId(id);
              }}
              placeholder="Search courts or type a place"
              className={inputCls}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES))}
              placeholder="Optional details"
              rows={3}
              className={`${inputCls} resize-y min-h-[4rem]`}
            />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={save}
              disabled={!canSave}
              className="flex-1 rounded-lg bg-court-green text-white py-2.5 text-sm font-semibold hover:bg-court-green-light transition-colors disabled:opacity-50"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Add event"}
            </button>
            {editing &&
              (confirmDelete ? (
                <button
                  onClick={remove}
                  disabled={deleting}
                  className="rounded-lg bg-red-600 text-white px-3 py-2.5 text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Confirm"}
                </button>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-lg bg-gray-100 text-gray-600 px-3 py-2.5 text-sm font-semibold hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete event"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 01-2 2H9a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6" /><path d="M14 11v6" />
                    <path d="M9 6V4a2 2 0 012-2h2a2 2 0 012 2v2" />
                  </svg>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const inputCls =
  "w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20";

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
