"use client";

import { useState } from "react";
import { searchFacilitiesByName, type Facility } from "@/lib/facilities";

interface CourtLocationPickerProps {
  value: string;
  facilityId: string | null;
  // Single callback for both the text and the facility id so the parent
  // never has to think about keeping them in sync. Picking from the
  // dropdown emits (facility.name, facility.courtId); typing emits the
  // new text with facilityId=null so a stale pick can't outlive the edit.
  onChange: (text: string, facilityId: string | null) => void;
  placeholder?: string;
  className?: string;
  /** Lets the caller mirror an existing field's id, e.g. for the label. */
  inputId?: string;
}

/**
 * Typeahead for the curated tennis-court catalog (data/tennis_courts.json
 * via src/lib/facilities.ts). Shows up to 6 fuzzy matches once the user
 * has typed 2 characters, then keyboard/mouse pick. Free text is allowed
 * — submitting without picking is fine; computeCourtFacilityId() in
 * facilities.ts gives free-text entries a last-chance resolve at save time.
 *
 * Used by both PostComposer (post creation) and PostCard's inline edit
 * so they stay behaviorally identical.
 */
export default function CourtLocationPicker({
  value,
  facilityId,
  onChange,
  placeholder,
  className,
  inputId,
}: CourtLocationPickerProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const suggestions: Facility[] = value.trim().length >= 2
    ? searchFacilitiesByName(value, 6)
    : [];

  const select = (f: Facility) => {
    onChange(f.name, f.courtId);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        id={inputId}
        type="text"
        value={value}
        onChange={(e) => {
          // Editing the text decouples from any prior pick — the
          // resolver fallback runs on submit to reattach a catalog id
          // when the new text still matches a known court.
          onChange(e.target.value, null);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => {
          if (value.trim().length >= 2) setOpen(true);
        }}
        onBlur={() => {
          // Delay so a click on a suggestion lands before the dropdown
          // unmounts. Same trick used by the /courts search bar.
          setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            const pick = suggestions[highlighted];
            if (pick) select(pick);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-autocomplete="list"
        // Marker so test code can find the field without grepping by label.
        data-court-facility-id={facilityId ?? ""}
        className={
          className ??
          "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
        }
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-20 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg"
        >
          {suggestions.map((f, idx) => (
            <li
              key={f.courtId}
              role="option"
              aria-selected={idx === highlighted}
              // onMouseDown fires before the input's onBlur, so the pick
              // lands without the blur-driven close racing it.
              onMouseDown={(e) => {
                e.preventDefault();
                select(f);
              }}
              onMouseEnter={() => setHighlighted(idx)}
              className={`px-3 py-2 cursor-pointer ${
                idx === highlighted ? "bg-court-green-pale/30" : ""
              }`}
            >
              <div className="text-sm font-semibold text-gray-900">{f.name}</div>
              {(f.city || f.state) && (
                <div className="text-xs text-gray-500">
                  {[f.city, f.state].filter(Boolean).join(", ")}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
