"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  addRosterPlaceholders,
  getRosterPlaceholderLinks,
  mintRosterLink,
  revokeRosterLink,
  type PlaceholderLink,
  type PlaceholderScope,
} from "@/lib/supabase/queries";
import { nativeShare } from "@/lib/lfpShare";
import { errorMessage } from "@/lib/errorMessage";
import { parsePeopleLines } from "@/lib/parsePeople";

/**
 * Captain-facing panel to collect availability from players who AREN'T on the
 * app — it does NOT invite anyone to TennisFriend. It adds account-less names to
 * the availability tables, shares each person's personal RSVP link, and manages
 * one shared "self-add" link. These people RSVP without an account and never
 * become team members (that's what the email/phone invite is for). Mounted on
 * the availability page; `onChanged` lets the host refresh its roster/matrix.
 */
export default function InvitePlayersPanel({
  groupId,
  groupName,
  onChanged,
  scope = "all",
}: {
  groupId: string;
  groupName: string;
  onChanged?: () => void;
  // The default table to invite to (pre-selected from the surface the panel is
  // opened on). The captain can change it with the selector below.
  scope?: PlaceholderScope;
}) {
  // Which table the people being added should RSVP to. Captain-selectable.
  const [selectedScope, setSelectedScope] = useState<PlaceholderScope>(scope);
  const SCOPE_OPTIONS: { value: PlaceholderScope; label: string }[] = [
    { value: "match", label: "Matches" },
    { value: "practice", label: "Practices" },
    { value: "poll", label: "Polls" },
    { value: "all", label: "Everything" },
  ];
  const [bulkNames, setBulkNames] = useState("");
  const [adding, setAdding] = useState(false);
  const [links, setLinks] = useState<PlaceholderLink[]>([]);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  // Shared self-add link token — managed locally since it isn't on the loaded
  // group object; mint returns the token, revoke clears it.
  const [sharedToken, setSharedToken] = useState("");
  const [sharedBusy, setSharedBusy] = useState(false);

  // Parse the textarea: one person per line, optionally "Name, email-or-phone".
  const parsedPeople = parsePeopleLines(bulkNames);

  const loadLinks = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      setLinks(await getRosterPlaceholderLinks(supabase, groupId));
    } catch {
      // Non-fatal — Share buttons just won't have a token to share.
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLinks();
  }, [loadLinks]);

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
      await addRosterPlaceholders(supabase, groupId, parsedPeople, selectedScope);
      setMsg(`${parsedPeople.length} ${parsedPeople.length === 1 ? "person" : "people"} added.`);
      setBulkNames("");
      onChanged?.();
      await loadLinks();
    } catch (e) {
      setErr(errorMessage(e, "Failed to add people."));
    }
    setAdding(false);
  };

  const shareLink = async (name: string, token: string) => {
    await nativeShare(
      {
        title: `Set your availability for ${groupName}`,
        text: `Set your availability for ${groupName} — mark which matches you can play (no account needed): `,
        url: `${window.location.origin}/rsvp/${token}`,
      },
      "rosterShare"
    );
  };

  const copyAll = async () => {
    setErr("");
    setMsg("");
    if (links.length === 0) return;
    const origin = window.location.origin;
    const digest = links.map((l) => `${l.name} — ${origin}/rsvp/${l.token}`).join("\n");
    const res = await nativeShare({ title: "", text: digest, url: "" }, "rosterShare");
    if (res.outcome === "copied") setMsg("All links copied — paste them into your team chat.");
  };

  const mintShared = async () => {
    setErr("");
    setMsg("");
    setSharedBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const token = await mintRosterLink(supabase, groupId);
      setMsg(sharedToken ? "Shared availability link rotated." : "Shared availability link created.");
      setSharedToken(token);
    } catch (e) {
      setErr(errorMessage(e, "Failed to create link."));
    }
    setSharedBusy(false);
  };

  const shareShared = async () => {
    if (!sharedToken) return;
    await nativeShare(
      {
        title: `Set your availability for ${groupName}`,
        text: `Add your name and mark which matches you can play for ${groupName} — no account needed: `,
        url: `${window.location.origin}/rsvp/team/${sharedToken}`,
      },
      "rosterShare"
    );
  };

  const disableShared = async () => {
    setErr("");
    setMsg("");
    setSharedBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await revokeRosterLink(supabase, groupId);
      setSharedToken("");
      setMsg("Shared availability link disabled.");
    } catch (e) {
      setErr(errorMessage(e, "Failed to disable link."));
    }
    setSharedBusy(false);
  };

  return (
    <div className="space-y-5">
      {/* Intro — this whole panel is RSVP collection, NOT an app invite. */}
      <p className="text-[11px] text-gray-500 leading-snug">
        Get availability from players who aren&apos;t on the app. They RSVP through a link —
        no account needed, and they won&apos;t appear as team members. (To bring someone into
        the app, use <span className="font-semibold">Invite players</span> in team settings.)
      </p>

      {/* Add people by name */}
      <div>
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Add people by name</h3>
        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
          <p className="text-[11px] text-gray-500 leading-snug">
            They&apos;ll show on your availability tables so their availability can be tracked.
            No account, not a member.
          </p>

          {/* Which table the invited people should RSVP to */}
          <div>
            <p className="text-[11px] font-semibold text-gray-600 mb-1">They should RSVP to:</p>
            <div className="flex flex-wrap gap-1.5">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSelectedScope(opt.value)}
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    selectedScope === opt.value
                      ? "bg-court-green text-white border-court-green"
                      : "bg-white text-gray-600 border-gray-300 hover:border-court-green-pale"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">
              {selectedScope === "all"
                ? "They'll appear on every table and see matches, practices, and polls."
                : `They'll only appear on the ${SCOPE_OPTIONS.find((o) => o.value === selectedScope)?.label.toLowerCase()} table and see only that.`}
            </p>
          </div>
          <textarea
            value={bulkNames}
            onChange={(e) => setBulkNames(e.target.value)}
            rows={4}
            placeholder={'One name per line. Optionally add a phone or email: "Sam Lee, sam@x.com"'}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green resize-y"
          />
          {parsedPeople.length > 0 && (
            <p className="text-[11px] text-court-green font-semibold">
              {parsedPeople.length} {parsedPeople.length === 1 ? "person" : "people"} will be added
            </p>
          )}
          <button onClick={addPeople} disabled={adding || parsedPeople.length === 0} className="btn-primary w-full">
            {adding ? "Adding..." : "Add to availability list"}
          </button>
          {msg && <p className="text-xs text-court-green">{msg}</p>}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      </div>

      {/* Personal links — one per not-yet-joined member */}
      {links.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
            Personal links — send each person theirs
          </h3>
          <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
            <ul className="divide-y divide-gray-200">
              {links.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="text-sm text-gray-800 truncate">{l.name}</span>
                  <button
                    onClick={() => shareLink(l.name, l.token)}
                    className="text-[11px] font-semibold text-court-green hover:underline shrink-0"
                  >
                    Share
                  </button>
                </li>
              ))}
            </ul>
            <button onClick={copyAll} className="btn-secondary w-full">
              Copy all links
            </button>
          </div>
        </div>
      )}

      {/* Shared availability link — one link anyone can use to add their own
          name and RSVP; only offered when tracking everything, not one table. */}
      {selectedScope === "all" && (
      <div>
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Shared availability link</h3>
        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
          <p className="text-[11px] text-gray-500 leading-snug">
            Anyone with this link can add their own name and mark their availability — no
            account needed. They won&apos;t become team members.
          </p>
          {!sharedToken ? (
            <button onClick={mintShared} disabled={sharedBusy} className="btn-primary w-full">
              {sharedBusy ? "Working..." : "Create link"}
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={shareShared} disabled={sharedBusy} className="btn-primary flex-1">
                Share
              </button>
              <button onClick={mintShared} disabled={sharedBusy} className="btn-secondary flex-1">
                {sharedBusy ? "..." : "Rotate"}
              </button>
              <button
                onClick={disableShared}
                disabled={sharedBusy}
                className="text-xs font-semibold text-red-500 hover:text-red-600 px-2"
              >
                Disable
              </button>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
