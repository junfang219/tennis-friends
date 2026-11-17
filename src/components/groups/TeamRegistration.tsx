"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { useTeamManagement, teamResponse } from "./useTeamManagement";
import { registrationPlayers, type TeamManagementState, teamManagementMutationSchema } from "@/lib/onboarding/management";
import { formatDeadline } from "@/lib/registrationOnboarding";
const preparedSchema = z.array(z.object({ id: z.uuid(), name: z.string(), message: z.string() }));
const input = "mt-1 w-full rounded-xl border border-gray-300 p-3 text-base";
export default function TeamRegistration({ groupId }: { groupId: string }) {
  const management = useTeamManagement(groupId);
  return management.state ? <RegistrationEditor groupId={groupId} state={management.state} mutate={management.mutate} load={management.load} /> : <p role={management.error ? "alert" : undefined} className="text-sm text-gray-600">{management.error || "Loading USTA registration…"}</p>;
}
export function RegistrationEditor({ groupId, state, mutate, load, hideConfirmations = false }: { hideConfirmations?: boolean; groupId: string; state: TeamManagementState; mutate: ReturnType<typeof useTeamManagement>["mutate"]; load: ReturnType<typeof useTeamManagement>["load"] }) {
  const c = state.config;
  const [enabled, setEnabled] = useState(Boolean(c.includeUsta)); const [name, setName] = useState(c.ustaTeamName ?? c.name);
  const [number, setNumber] = useState(c.teamNumber); const [deadline, setDeadline] = useState(c.deadline); const [withLink, setLink] = useState(c.includeRegistrationLink !== false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [prepared, setPrepared] = useState<z.infer<typeof preparedSchema>>([]);
  const batch = useRef<string | null>(null);
  const players = registrationPlayers(state); const missing = players.filter(p => !p.confirmed_at);
  const dirty = enabled !== Boolean(c.includeUsta) || name !== (c.ustaTeamName ?? c.name) || number !== c.teamNumber || deadline !== c.deadline || withLink !== (c.includeRegistrationLink !== false);
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Could not complete action"); } finally { setBusy(false); } }
  async function send(mode: "prepare" | "email") {
    batch.current ??= crypto.randomUUID();
    const raw = await teamResponse(await fetch(`/api/team-onboarding/${groupId}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, reminder: true, batchId: batch.current }) }));
    if (mode === "prepare") { setPrepared(z.object({ invitations: preparedSchema }).parse(raw).invitations); setNotice("Reminders are ready to share. No messages were sent automatically."); }
    else { const report = z.object({ sent: z.number(), failed: z.number(), pending: z.number(), message: z.string() }).parse(raw); setNotice(`${report.sent} emails accepted; ${report.failed} failed; ${report.pending} pending. ${report.message}`); if (!report.failed && !report.pending) batch.current = null; }
    await load();
  }
  return <div className="space-y-5"><p className="text-sm text-gray-600">USTA registration is optional and separate from joining this team. Captains check the official roster before confirming or reminding players.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}{notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-950">{notice}</p>}
    <fieldset disabled={busy} className="space-y-5 min-w-0">
      <form className="rounded-2xl border bg-white p-5 space-y-4" onSubmit={e => { e.preventDefault(); void action(async () => {
        const change = teamManagementMutationSchema.parse({ action: "registration", includeUsta: enabled, ustaTeamName: name, teamNumber: number, deadline, includeRegistrationLink: withLink });
        await mutate(change); batch.current = null; setPrepared([]); setNotice("USTA registration settings saved.");
      }); }}>
        <h2 className="text-xl font-bold">Registration details</h2><label className="flex gap-3 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable USTA registration</label>
        {enabled && <><label className="block text-sm">USTA team name<input className={input} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label><label className="block text-sm">USTA team number<input className={input} inputMode="numeric" required pattern="[0-9]{10}" maxLength={10} value={number} onChange={e => setNumber(e.target.value)} /></label><label className="block text-sm">Registration deadline<input className={input} type="date" required value={deadline} onChange={e => setDeadline(e.target.value)} /></label><label className="flex gap-3 text-sm"><input type="checkbox" checked={withLink} onChange={e => setLink(e.target.checked)} />Include USTA registration link in messages</label></>}
        <button type="submit" className="btn-primary h-12 w-full">{busy ? "Saving…" : "Save registration details"}</button>
      </form>
      {c.includeUsta && <>{!hideConfirmations && <section className="rounded-2xl border bg-white p-5 space-y-4"><h2 className="text-xl font-bold">Registration confirmations</h2><p className="text-sm">{players.filter(p => p.confirmed_at).length} of {players.length} confirmed · {formatDeadline(c.deadline)}</p><ul className="divide-y">{players.map(p => <li key={p.id} className="py-4 space-y-2"><strong className="break-words">{p.name}</strong><p className="text-sm">{p.confirmed_at ? "Confirmed by captain" : "Unconfirmed"}</p><button type="button" className="btn-secondary w-full" aria-label={`${p.confirmed_at ? "Undo confirmation for" : "Confirm registration for"} ${p.name}`} onClick={() => void action(async () => { await mutate({ action: "confirmation", playerId: p.id, confirmed: !p.confirmed_at }); batch.current = null; setPrepared([]); })}>{p.confirmed_at ? "Undo confirmation" : "Confirm from TennisLink"}</button></li>)}</ul></section>}
        <section className="rounded-2xl border bg-white p-5 space-y-4"><h2 className="text-xl font-bold">Registration reminders</h2><p className="text-sm">Only unconfirmed players: {missing.map(p => p.name).join(", ") || "None"}. Check TennisLink first; roster imports are not automatic.</p>{dirty && <p className="text-sm text-amber-900">Save your registration details before preparing reminders.</p>}<button type="button" disabled={dirty || !missing.length} className="btn-primary w-full disabled:opacity-50" onClick={() => void action(() => send("email"))}>Send email reminders</button><button type="button" disabled={dirty || !missing.length} className="btn-secondary w-full disabled:opacity-50" onClick={() => void action(() => send("prepare"))}>Prepare reminders to share</button>
          {prepared.filter(p => missing.some(member => member.id === p.id)).map(p => <div key={p.id} className="border-t pt-4 space-y-3"><strong className="break-words">{p.name}</strong><textarea aria-label={`Reminder for ${p.name}`} readOnly className={input} rows={5} value={p.message} /><button type="button" className="btn-secondary w-full" onClick={() => void action(async () => { if (typeof navigator.share === "function") { try { await navigator.share({ title: "USTA registration reminder", text: p.message }); return; } catch (e) { if (e instanceof Error && e.name === "AbortError") return; } } await navigator.clipboard.writeText(p.message); setNotice("Reminder copied. Paste it into your messaging app."); })}>Share reminder for {p.name}</button></div>)}
        </section></>}
    </fieldset>
  </div>;
}
