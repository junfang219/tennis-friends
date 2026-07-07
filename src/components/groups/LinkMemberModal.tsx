"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "@/components/Avatar";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listFriends, type FriendProfile } from "@/lib/supabase/queries/friends";
import { linkRosterPlaceholder } from "@/lib/supabase/queries/guestRsvp";
import { rankMembersFor } from "@/lib/rosterMatch";
import { errorMessage } from "@/lib/errorMessage";

/**
 * Captain-facing picker to attach an account-less roster placeholder (e.g. a
 * USTA import row) to one of the captain's friends. Friends are ranked by name
 * similarity to the placeholder so the intended teammate surfaces first.
 * Friends already on the team are excluded. The link itself (captain-gated,
 * friends-only) is enforced server-side by link_roster_placeholder.
 */
export default function LinkMemberModal({
  member,
  existingMemberUserIds,
  onClose,
  onLinked,
}: {
  member: { id: string; name: string };
  existingMemberUserIds: string[];
  onClose: () => void;
  onLinked: (result: { merged_existing: boolean; name: string }) => void;
}) {
  const [friends, setFriends] = useState<FriendProfile[] | null>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    listFriends(supabase)
      .then((all) => {
        if (cancelled) return;
        const excluded = new Set(existingMemberUserIds);
        const eligible = all.filter((f) => !excluded.has(f.id));
        // Rank closest-name-first so the intended teammate is the top row and
        // gets pre-selected. rankMembersFor keys on {memberId,name}.
        const ranked = rankMembersFor(
          member.name,
          eligible.map((f) => ({ memberId: f.id, name: f.name }))
        );
        const byId = new Map(eligible.map((f) => [f.id, f]));
        const ordered = ranked.map((r) => byId.get(r.memberId)!).filter(Boolean);
        setFriends(ordered);
        setSelectedId(ordered[0]?.id ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, "Could not load your friends."));
      });
    return () => {
      cancelled = true;
    };
  }, [member.name, existingMemberUserIds]);

  const shown = useMemo(() => {
    if (!friends) return [];
    const q = query.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => f.name.toLowerCase().includes(q));
  }, [friends, query]);

  const link = async () => {
    if (!selectedId || busy) return;
    const friend = friends?.find((f) => f.id === selectedId);
    if (!friend) return;
    setBusy(true);
    setError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await linkRosterPlaceholder(supabase, member.id, friend.id);
      onLinked({ merged_existing: result.merged_existing, name: friend.name });
    } catch (e) {
      setError(errorMessage(e, "Could not link this account."));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 pb-3">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-gray-900 truncate">
              Link {member.name}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Connect this imported name to a friend&apos;s account so they can RSVP in the app.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {friends === null ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">Loading friends…</div>
        ) : friends.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-500">
            No friends available to link. Add them as a friend first, or share their
            personal RSVP link instead.
          </div>
        ) : (
          <>
            <div className="px-5 pb-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends…"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-2 min-h-[6rem]">
              {shown.map((f) => {
                const selected = f.id === selectedId;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setSelectedId(f.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors ${
                      selected ? "bg-court-green-pale/40 ring-1 ring-court-green-pale" : "hover:bg-gray-50"
                    }`}
                  >
                    <Avatar name={f.name} image={f.profile_image_url} size="sm" />
                    <span className="flex-1 min-w-0 font-medium text-sm text-gray-800 truncate">
                      {f.name}
                    </span>
                    {selected && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-court-green shrink-0">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                );
              })}
              {shown.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-gray-400">No matches.</p>
              )}
            </div>
          </>
        )}

        {error && <p className="px-5 pt-2 text-sm text-red-600">{error}</p>}

        {friends !== null && friends.length > 0 && (
          <div className="p-5 pt-3">
            <button
              onClick={link}
              disabled={!selectedId || busy}
              className="btn-primary w-full disabled:opacity-50"
            >
              {busy ? "Linking…" : "Link account"}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
