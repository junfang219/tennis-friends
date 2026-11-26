"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { teamResponse } from "./useTeamManagement";

export default function TeamMembershipActions({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function updateMembership() {
    const message = isOwner
      ? "Delete this team? This removes the team and its chat, matches, and practices for all members. This cannot be undone."
      : "Leave this team? You'll lose access to the team chat and feed.";
    if (busy || !window.confirm(message)) return;
    setBusy(true);
    setError("");
    try {
      await teamResponse(await fetch(`/api/team-roster/${groupId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: isOwner ? "delete-team" : "leave-team" }),
      }));
      router.replace("/groups");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not complete team action");
      setBusy(false);
    }
  }

  return (
    <details
      className="scroll-mb-[calc(var(--native-tab-bar-height,0px)+1rem)] rounded-xl border border-gray-200 bg-white"
      onToggle={(event) => {
        const menu = event.currentTarget;
        if (menu.open) menu.scrollIntoView({ block: "nearest" });
      }}
    >
      <summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold text-court-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-court-green">
        Team actions
      </summary>
      <div className="border-t border-gray-200 px-4 pb-1">
        <button type="button" disabled={busy} className="min-h-11 text-sm underline text-red-800" onClick={updateMembership}>
          {busy ? "Working…" : isOwner ? "Delete team" : "Leave team"}
        </button>
        {error && <p role="alert" className="mb-3 text-sm text-red-800">{error}</p>}
      </div>
    </details>
  );
}
