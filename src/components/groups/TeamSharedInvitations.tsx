"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { teamLinkStateSchema } from "@/lib/onboarding/shared";
import type { RegistrationPlayer } from "@/lib/registrationOnboarding";

type State = z.infer<typeof teamLinkStateSchema>;
async function readResponse(response: Response): Promise<unknown> {
  const raw: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(raw);
    throw new Error(error.success ? error.data.error : "Could not complete the request");
  }
  return raw;
}
export default function TeamSharedInvitations({ groupId, players, onApproved, onBusyChange }: {
  groupId: string; players: RegistrationPlayer[]; onApproved: () => Promise<void>; onBusyChange: (busy: boolean) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const endpoint = `/api/team-onboarding/${groupId}`;
  const load = useCallback(async () => {
    const data = teamLinkStateSchema.parse(await readResponse(await fetch(`${endpoint}/shared-link`, { cache: "no-store" })));
    setState(data); setOrigin(window.location.origin);
  }, [endpoint]);
  useEffect(() => {
    let active = true;
    void fetch(`${endpoint}/shared-link`, { cache: "no-store" }).then(readResponse).then(raw => {
      const data = teamLinkStateSchema.parse(raw);
      if (active) { setState(data); setOrigin(window.location.origin); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not load team link"); });
    return () => { active = false; };
  }, [endpoint]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); onBusyChange(true); setError(""); setNotice("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Could not complete the request"); }
    finally { setBusy(false); onBusyChange(false); }
  }
  async function change(action: "enable" | "replace" | "disable") {
    const raw = await readResponse(await fetch(`${endpoint}/shared-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }));
    setState(teamLinkStateSchema.parse(raw));
    setNotice(action === "disable" ? "Team link disabled. Existing requests can still be reviewed." : action === "replace" ? "New team link ready. The previous link no longer works." : "Team link ready to share.");
  }
  const link = state?.token && state.enabled ? `${origin}/join-team/${state.token}` : "";
  const rosterEntry = (request: State["requests"][number]) =>
    selected[request.id] ?? players.find(p => !p.memberId && p.associatedAccountId === request.userId)?.id ?? "";
  return <section aria-label="Shared invitations and approvals" className="space-y-5">
    <fieldset disabled={busy} className="min-w-0 rounded-xl border border-gray-200 p-4 space-y-3 disabled:opacity-70">
      <legend className="px-1 font-semibold">Shared team invitation</legend>
      <p className="text-sm text-gray-700">Post one link in your group chat. Players sign in and request to join; you approve each request before they become team members.</p>
      {!state ? <p className="text-sm">{error ? "Team link could not be loaded." : "Loading team link…"}</p> : link ? <>
        <label className="block text-sm font-semibold">Team invitation link<input className="mt-1 w-full min-w-0 rounded-xl border border-gray-300 p-3 text-base" readOnly value={link} onFocus={e => e.target.select()} /></label>
        <div className="grid grid-cols-2 gap-3"><button type="button" className="btn-primary w-full" onClick={() => void action(async () => {
          if (typeof navigator.share === "function") {
            try { await navigator.share({ title: "Join our tennis team", text: "Request to join our team on TennisFriends. Captain approval is required.", url: link }); setNotice("Share sheet opened."); return; }
            catch (e) { if (e instanceof Error && e.name === "AbortError") return; }
          }
          await navigator.clipboard.writeText(link); setNotice("Team link copied. Paste it into your group chat.");
        })}>Share team link</button><button type="button" className="btn-secondary w-full" onClick={() => void action(async () => { await navigator.clipboard.writeText(link); setNotice("Team link copied."); })}>Copy link</button></div>
        <details><summary className="cursor-pointer text-sm font-semibold text-court-green">Manage team link</summary><div className="mt-3 space-y-3"><p className="text-xs text-gray-600">Replacing the link disables the old one. Disabling stops new requests. Neither action removes existing members or requests.</p><button type="button" className="btn-secondary w-full" onClick={() => void action(() => change("replace"))}>Replace team link</button><button type="button" className="text-sm underline text-red-800" onClick={() => void action(() => change("disable"))}>Disable team link</button></div></details>
      </> : <><p className="text-sm text-gray-600">{state.token ? "The shared link is disabled." : "No shared link has been created."}</p><button type="button" className="btn-primary w-full" onClick={() => void action(() => change(state.token ? "replace" : "enable"))}>{state.token ? "Create new team link" : "Create shared team link"}</button></>}
    </fieldset>
    <fieldset disabled={busy} className="min-w-0 rounded-xl border border-gray-200 p-4 space-y-3 disabled:opacity-70"><legend className="px-1 font-semibold">Join requests{state ? ` (${state.requests.length})` : ""}</legend>
      <button type="button" className="text-sm underline text-court-green" onClick={() => void action(load)}>Refresh requests</button>
      {state?.requests.length === 0 && <p className="text-sm text-gray-600">No pending requests. Players using the shared link will appear here after signing in and requesting to join.</p>}
      <ul className="divide-y divide-gray-200">{state?.requests.map(request => <li key={request.id} className="py-4 space-y-3">
        <strong className="break-words">{request.name}</strong>{request.email && <p className="text-sm break-all">{request.email}</p>}
        <label className="block text-sm">Roster entry for {request.name}<select className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base" value={rosterEntry(request)} onChange={e => setSelected(s => ({ ...s, [request.id]: e.target.value }))}><option value="">Add as a new player</option>{players.filter(p => !p.memberId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <p className="text-xs text-gray-600">Choose an existing roster entry to keep its registration history, or add this person as a new player.</p>
        <div className="grid grid-cols-2 gap-3">{(["approve", "reject"] as const).map(decision => <button key={decision} type="button" className={`${decision === "approve" ? "btn-primary" : "btn-secondary"} w-full`} aria-label={`${decision === "approve" ? "Approve" : "Reject"} ${request.name}`} onClick={() => void action(async () => {
          const raw = await readResponse(await fetch(`${endpoint}/join-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: request.id, decision, playerId: rosterEntry(request) || null }) }));
          z.object({ status: z.enum(["approved", "rejected"]) }).parse(raw);
          await onApproved(); await load(); setNotice(decision === "approve" ? `${request.name} is now a team member.` : `Request from ${request.name} rejected.`);
        })}>{decision === "approve" ? "Approve" : "Reject"}</button>)}</div>
      </li>)}</ul>
    </fieldset>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}{notice && <p role="status" className="text-sm text-green-950">{notice}</p>}
  </section>;
}
