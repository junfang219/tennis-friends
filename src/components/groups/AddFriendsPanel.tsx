"use client";

import { useEffect, useMemo, useState } from "react";
import Avatar from "@/components/Avatar";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listFriends, type FriendProfile } from "@/lib/supabase/queries/friends";
import { errorMessage } from "@/lib/errorMessage";

/**
 * "Add from your friends" — the instant-member path: pick friends already on
 * TennisFriend and insert them directly as `group_members` (real members, no
 * invite needed — the group_members_notify_added DB trigger sends them a
 * team_linked notification + push). Manager-gated by RLS (group_members_insert_manager →
 * can_admin_group). Friends already on the team are excluded.
 */
export default function AddFriendsPanel({
  groupId,
  existingMemberUserIds,
  onAdded,
}: {
  groupId: string;
  existingMemberUserIds: string[];
  onAdded?: () => void;
}) {
  const [friends, setFriends] = useState<FriendProfile[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    listFriends(supabase)
      .then((rows) => {
        if (!cancelled) setFriends(rows);
      })
      .catch((e) => {
        if (!cancelled) setErr(errorMessage(e, "Couldn't load your friends."));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const excluded = useMemo(() => new Set(existingMemberUserIds), [existingMemberUserIds]);
  const addable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (friends ?? [])
      .filter((f) => !excluded.has(f.id))
      .filter((f) => (q ? f.name.toLowerCase().includes(q) : true));
  }, [friends, excluded, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const add = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const supabase = createSupabaseBrowserClient();
      const rows = Array.from(selected).map((uid) => ({
        group_id: groupId,
        user_id: uid,
        roles: [] as ("manager" | "captain")[],
      }));
      const { error } = await supabase.from("group_members").insert(rows);
      if (error) throw error;
      setMsg(`Added ${rows.length} ${rows.length === 1 ? "friend" : "friends"} to the team.`);
      setSelected(new Set());
      onAdded?.();
    } catch (e) {
      setErr(errorMessage(e, "Couldn't add those friends."));
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500 leading-snug">
        Friends already on TennisFriend join instantly as members — no invite needed.
      </p>

      {friends === null ? (
        <p className="text-sm text-gray-400 py-6 text-center">Loading friends…</p>
      ) : (
        <>
          <div className="relative">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search friends…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
            />
          </div>

          <div className="rounded-xl border border-gray-100 p-2 space-y-1">
            {addable.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">
                {friends.length === 0
                  ? "No friends yet — invite people by email or phone instead."
                  : "All your friends are already on this team."}
              </p>
            ) : (
              addable.map((f) => {
                const on = selected.has(f.id);
                return (
                  <label
                    key={f.id}
                    className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${
                      on ? "bg-court-green-soft/10 ring-1 ring-court-green-soft/30" : "hover:bg-gray-50"
                    }`}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(f.id)} className="sr-only" />
                    <div
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                        on ? "bg-court-green border-court-green" : "border-gray-300"
                      }`}
                    >
                      {on && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                          <polyline points="20,6 9,17 4,12" />
                        </svg>
                      )}
                    </div>
                    <Avatar name={f.name} image={f.profile_image_url} size="sm" />
                    <span className="text-sm font-medium text-gray-800 truncate">{f.name}</span>
                  </label>
                );
              })
            )}
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}
          {msg && <p className="text-xs text-court-green">{msg}</p>}

          <button onClick={add} disabled={selected.size === 0 || saving} className="btn-primary w-full disabled:opacity-50">
            {saving
              ? "Adding…"
              : selected.size === 0
                ? "Select friends to add"
                : `Add ${selected.size} to the team`}
          </button>
        </>
      )}
    </div>
  );
}
