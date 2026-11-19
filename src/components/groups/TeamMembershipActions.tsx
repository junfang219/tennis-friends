"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { teamResponse } from "./useTeamManagement";
export default function TeamMembershipActions({ groupId, isOwner }: { groupId: string; isOwner: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <details className="rounded-xl border border-gray-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-gray-700">Team actions</summary><div className="pt-3 space-y-3"><button type="button" disabled={busy} className="text-sm underline text-red-800" onClick={() => {
    const message = isOwner ? "Delete this team? This removes the team and its chat, matches, and practices for all members. This cannot be undone." : "Leave this team? You'll lose access to the team chat and feed.";
    if (busy || !window.confirm(message)) return;
    setBusy(true); setError("");
    void fetch(`/api/team-roster/${groupId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: isOwner ? "delete-team" : "leave-team" }) }).then(teamResponse).then(() => { router.replace("/groups"); router.refresh(); }).catch(e => { setError(e instanceof Error ? e.message : "Could not complete team action"); setBusy(false); });
  }}>{busy ? "Working…" : isOwner ? "Delete team" : "Leave team"}</button>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}</div></details>;
}
