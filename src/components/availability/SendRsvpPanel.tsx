"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  addRosterPlaceholders,
  getRosterPlaceholderLinks,
  type PlaceholderLink,
} from "@/lib/supabase/queries";
import { nativeShare } from "@/lib/lfpShare";
import { errorMessage } from "@/lib/errorMessage";
import { parsePeopleLines } from "@/lib/parsePeople";
import { formatDateHeader } from "@/lib/lineupMessage";
import { buildRsvpRequestText, availabilityLink } from "@/lib/rsvpRequest";

export type SendRsvpMatch = {
  id: string;
  matchDate: string;
  matchTime: string;
  location: string;
  opponent: string;
};

/**
 * Captain-facing "Send RSVP" panel for the Matches tab. The captain picks which
 * upcoming matches to request availability for, then shares an RSVP request with
 * the whole team (one in-app availability link) and/or each guest (their personal
 * /rsvp/{token}). Matches are mentioned for context only — recipients still see
 * their full upcoming set on the RSVP surface. Share-based: no auto chat/push.
 */
export default function SendRsvpPanel({
  groupId,
  groupName,
  matches,
  onChanged,
}: {
  groupId: string;
  groupName: string;
  matches: SendRsvpMatch[];
  onChanged?: () => void;
}) {
  // Upcoming matches only (today or later). matchDate is "YYYY-MM-DD", which
  // sorts lexicographically, so a string compare against today is correct.
  const today = useMemo(() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }, []);
  const upcoming = useMemo(
    () => matches.filter((m) => m.matchDate >= today),
    [matches, today],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Default: all upcoming selected. Re-seed when the upcoming set changes (e.g.
  // matches finish loading). Deliberate sync to props — same pattern as loadLinks.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds(new Set(upcoming.map((m) => m.id)));
  }, [upcoming]);

  const [links, setLinks] = useState<PlaceholderLink[]>([]);
  const [bulkNames, setBulkNames] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const loadLinks = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      setLinks(await getRosterPlaceholderLinks(supabase, groupId));
    } catch {
      // Non-fatal — guest Share buttons just won't have a token.
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLinks();
  }, [loadLinks]);

  const selectedMatches = useMemo(
    () => upcoming.filter((m) => selectedIds.has(m.id)),
    [upcoming, selectedIds],
  );
  const canShare = selectedMatches.length > 0;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = selectedIds.size === upcoming.length && upcoming.length > 0;
  const toggleAll = () =>
    setSelectedIds(allSelected ? new Set() : new Set(upcoming.map((m) => m.id)));

  const requestText = () =>
    buildRsvpRequestText(
      groupName,
      selectedMatches.map((m) => ({
        matchDate: m.matchDate,
        matchTime: m.matchTime,
        opponent: m.opponent,
        location: m.location,
      })),
    );

  const shareTeam = async () => {
    if (!canShare) return;
    await nativeShare(
      {
        title: `RSVP for ${groupName}`,
        text: `${requestText()} `,
        url: availabilityLink(
          window.location.origin,
          groupId,
          selectedMatches.map((m) => m.id),
        ),
      },
      "rsvpRequest",
    );
  };

  const shareGuest = async (token: string) => {
    if (!canShare) return;
    await nativeShare(
      {
        title: `RSVP for ${groupName}`,
        text: `${requestText()} `,
        url: `${window.location.origin}/rsvp/${token}`,
      },
      "rsvpRequest",
    );
  };

  const copyAllGuests = async () => {
    if (links.length === 0) return;
    const origin = window.location.origin;
    const digest = links
      .map((l) => `${l.name} — ${origin}/rsvp/${l.token}`)
      .join("\n");
    const res = await nativeShare(
      { title: "", text: digest, url: "" },
      "rsvpRequest",
    );
    if (res.outcome === "copied")
      setMsg("Guest links copied — send each person theirs.");
  };

  const parsedPeople = parsePeopleLines(bulkNames);
  const addPeople = async () => {
    setErr("");
    setMsg("");
    if (parsedPeople.length === 0) {
      setErr("Add at least one name.");
      return;
    }
    setAdding(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await addRosterPlaceholders(supabase, groupId, parsedPeople, "match");
      setMsg(
        `${parsedPeople.length} ${parsedPeople.length === 1 ? "person" : "people"} added.`,
      );
      setBulkNames("");
      onChanged?.();
      await loadLinks();
    } catch (e) {
      setErr(errorMessage(e, "Failed to add people."));
    }
    setAdding(false);
  };

  return (
    <div className="space-y-5">
      {/* Pick matches */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            Which matches?
          </h3>
          {upcoming.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="text-[11px] font-semibold text-court-green hover:underline"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-gray-500 p-3 rounded-xl border border-gray-200 bg-gray-50">
            No upcoming matches to request RSVPs for. Add a match first.
          </p>
        ) : (
          <ul className="rounded-xl border border-gray-200 divide-y divide-gray-100 max-h-56 overflow-y-auto">
            {upcoming.map((m) => (
              <li key={m.id}>
                <label className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(m.id)}
                    onChange={() => toggle(m.id)}
                    className="mt-0.5 w-4 h-4 accent-court-green shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">
                      {formatDateHeader(m.matchDate)}
                      {m.matchTime ? ` · ${m.matchTime}` : ""}
                    </span>
                    <span className="block text-xs text-gray-500 truncate">
                      {[m.opponent ? `vs ${m.opponent}` : "", m.location]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Members on TennisFriend — one shared in-app link */}
      <div>
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
          Members on TennisFriend
        </h3>
        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
          <p className="text-[11px] text-gray-500 leading-snug">
            Share one RSVP link with the whole team — post it in your team chat or
            send it however you like. Members tap it to set their availability.
          </p>
          <button
            onClick={shareTeam}
            disabled={!canShare}
            className="btn-primary w-full"
          >
            Share RSVP request
          </button>
        </div>
      </div>

      {/* Guests — personal per-person links */}
      {links.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Guests — send each person theirs
          </h3>
          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
            <p className="text-[11px] text-gray-500 leading-snug">
              Not on TennisFriend yet — each has a personal link (no signup
              needed; they&apos;re nudged to create an account to see more).
            </p>
            <ul className="divide-y divide-gray-200">
              {links.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center justify-between gap-2 py-1.5"
                >
                  <span className="text-sm text-gray-800 truncate">{l.name}</span>
                  <button
                    onClick={() => shareGuest(l.token)}
                    disabled={!canShare}
                    className="text-[11px] font-semibold text-court-green hover:underline shrink-0 disabled:opacity-40 disabled:no-underline"
                  >
                    Share
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={copyAllGuests} className="btn-secondary w-full">
              Copy all guest links
            </button>
          </div>
        </div>
      )}

      {/* Add someone not listed (secondary) */}
      <div>
        {!showAdd ? (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-xs font-semibold text-court-green hover:underline"
          >
            + Add someone not listed
          </button>
        ) : (
          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
            <p className="text-[11px] text-gray-500 leading-snug">
              Add teammates who aren&apos;t on TennisFriend yet. Each gets a
              personal RSVP link and appears on the matches table.
            </p>
            <textarea
              value={bulkNames}
              onChange={(e) => setBulkNames(e.target.value)}
              rows={3}
              placeholder={
                'One name per line. Optionally add a phone or email: "Sam Lee, sam@x.com"'
              }
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green resize-y"
            />
            {parsedPeople.length > 0 && (
              <p className="text-[11px] text-court-green font-semibold">
                {parsedPeople.length}{" "}
                {parsedPeople.length === 1 ? "person" : "people"} will be added
              </p>
            )}
            <button
              onClick={addPeople}
              disabled={adding || parsedPeople.length === 0}
              className="btn-primary w-full"
            >
              {adding ? "Adding..." : "Add to roster"}
            </button>
          </div>
        )}
      </div>

      {msg && <p className="text-xs text-court-green">{msg}</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}
