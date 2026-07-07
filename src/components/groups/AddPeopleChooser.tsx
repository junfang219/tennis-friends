"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import AddFriendsPanel from "@/components/groups/AddFriendsPanel";
import InviteToTeamPanel from "@/components/groups/InviteToTeamPanel";
import InvitePlayersPanel from "@/components/groups/InvitePlayersPanel";

/**
 * One entry point for "add people to a team" that forks the distinct paths so a
 * captain can't confuse them:
 *   ① Add from friends     → friends already on the app join instantly.
 *   ② Invite to the team   → email/phone; they create an account and join.
 *   ③ Track availability   → account-less name; RSVPs by link, can join later.
 * Each card reveals its sub-panel in place.
 */
export default function AddPeopleChooser({
  groupId,
  groupName,
  memberTypes,
  callerIsOwner,
  currentUserName,
  existingMemberUserIds,
  onClose,
  onChanged,
}: {
  groupId: string;
  groupName: string;
  memberTypes: string[];
  callerIsOwner: boolean;
  currentUserName: string;
  existingMemberUserIds: string[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "friends" | "invite" | "availability">("choose");

  const title =
    mode === "friends"
      ? "Add from your friends"
      : mode === "invite"
        ? "Invite to the team"
        : mode === "availability"
          ? "Track availability only"
          : `Add people to ${groupName}`;

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {mode !== "choose" && (
              <button
                onClick={() => setMode("choose")}
                className="p-1 -ml-1 text-gray-400 hover:text-gray-600 shrink-0"
                aria-label="Back"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            )}
            <h2 className="font-display text-lg font-bold text-gray-900 truncate">{title}</h2>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 shrink-0" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {mode === "choose" && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Pick the way that fits.</p>
            <button
              onClick={() => setMode("friends")}
              className="w-full text-left rounded-2xl border border-court-green-pale/40 bg-court-green/5 p-4 hover:bg-court-green/10 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-court-green text-white flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-gray-900">Add from your friends</span>
                  <span className="block text-xs text-gray-600 mt-0.5">
                    Friends already on TennisFriend join instantly as members — no invite needed.
                  </span>
                </span>
              </div>
            </button>
            <button
              onClick={() => setMode("invite")}
              className="w-full text-left rounded-2xl border border-court-green-pale/40 bg-court-green/5 p-4 hover:bg-court-green/10 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-court-green text-white flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-gray-900">Invite to the team</span>
                  <span className="block text-xs text-gray-600 mt-0.5">
                    They create a free account and become a member — chat, RSVP, see everyone. Best when they&apos;ll use the app.
                  </span>
                </span>
              </div>
            </button>
            <button
              onClick={() => setMode("availability")}
              className="w-full text-left rounded-2xl border border-gray-200 bg-gray-50 p-4 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-gray-500 text-white flex items-center justify-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                    <path d="M9 16l2 2 4-4" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-gray-900">Track availability only</span>
                  <span className="block text-xs text-gray-600 mt-0.5">
                    Add their name to collect availability. No account needed; they RSVP by link and can become a member later. Best for teammates who won&apos;t sign up.
                  </span>
                </span>
              </div>
            </button>
          </div>
        )}

        {mode === "friends" && (
          <AddFriendsPanel
            groupId={groupId}
            existingMemberUserIds={existingMemberUserIds}
            onAdded={onChanged}
          />
        )}

        {mode === "invite" && (
          <InviteToTeamPanel
            groupId={groupId}
            groupName={groupName}
            memberTypes={memberTypes}
            callerIsOwner={callerIsOwner}
            currentUserName={currentUserName}
          />
        )}

        {mode === "availability" && (
          <InvitePlayersPanel groupId={groupId} groupName={groupName} scope="all" onChanged={onChanged} />
        )}
      </div>
    </div>,
    document.body
  );
}
