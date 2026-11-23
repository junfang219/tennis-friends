"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { createTeamSchema } from "@/lib/onboarding/management";
import TeamSetupProgress from "./TeamSetupProgress";
import { teamResponse } from "./useTeamManagement";
export default function CreateTeamForm({ groupId, initialDetails }: { groupId: string; initialDetails?: { name: string; description: string } }) {
  const router = useRouter();
  const [name, setName] = useState(initialDetails?.name ?? ""); const [description, setDescription] = useState(initialDetails?.description ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <main className="max-w-2xl mx-auto p-4 py-8 space-y-5">
    <header className="flex items-center justify-between gap-3">
      <h1 className="font-display text-3xl font-bold text-court-green">{initialDetails ? "Team details" : "Create your team"}</h1>
      <Link
        href="/groups"
        replace
        aria-label="Close team details"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-700"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </Link>
    </header>
    <TeamSetupProgress step={1} />
    <p className="text-gray-600">Start with your team’s details, then add players in the next step.</p>
    <form className="rounded-2xl border border-gray-200 bg-white p-5 space-y-5" onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); setError(""); void (async () => {
      try {
        const body = createTeamSchema.parse({ name, description });
        const raw = await teamResponse(await fetch(`/api/team-onboarding/${groupId}/create`, { method: initialDetails ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
        const result = z.object({ groupId: z.uuid() }).parse(raw);
        router.replace(`/groups/${result.groupId}/invite-players?setup=1`);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not create team"); setBusy(false); }
    })(); }}>
      <fieldset disabled={busy} className="space-y-5 min-w-0">
        <label className="block text-sm font-semibold">Team name<input required maxLength={100} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base" value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="block text-sm font-semibold">Description (optional)<textarea maxLength={2000} rows={4} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base" value={description} onChange={e => setDescription(e.target.value)} /></label>
        <button type="submit" className="btn-primary h-12 w-full">{busy ? "Saving…" : initialDetails ? "Save & continue" : "Create team & continue"}</button>
      </fieldset>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </form>
    {!initialDetails && <section className="rounded-2xl border border-court-green/25 bg-court-green/5 p-5 space-y-3"><h2 className="font-semibold text-court-green">Already have a USTA team?</h2><p className="text-sm text-gray-700">Import its schedule and roster through the existing USTA setup.</p><Link href="/groups?setup=existing" className="btn-secondary block text-center">Import a USTA team</Link></section>}
  </main>;
}
