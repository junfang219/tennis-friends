"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import TeamSharedInvitations from "./TeamSharedInvitations";
import AddFriendsPanel from "./AddFriendsPanel";
import InvitePlayersPanel from "./InvitePlayersPanel";
import { useTeamManagement, teamResponse } from "./useTeamManagement";
import type { RosterGroup } from "./TeamRoster";
import { recipientSchema } from "@/lib/onboarding/management";
import type { storedPlayerSchema } from "@/lib/onboarding/contracts";
type Player = z.infer<typeof storedPlayerSchema>;
const input = "mt-1 w-full rounded-xl border border-gray-300 p-3 text-base";
function RecipientEditor({ player, save }: { player: Player; save: (change: { name: string; email: string; associatedAccountId: string | null }) => Promise<void> }) {
  const [name, setName] = useState(player.name); const [email, setEmail] = useState(player.email ?? "");
  const [associatedAccountId, setAccount] = useState(player.associated_account_id);
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save({ name, email, associatedAccountId }); }}>
    <label className="block text-sm">Name<input required className={input} value={name} onChange={e => setName(e.target.value)} /></label>
    <label className="block text-sm">Email<input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} /></label>
    {player.associated_account_id && <label className="block text-sm">Associated account<select className={input} value={associatedAccountId ?? ""} onChange={e => setAccount(e.target.value || null)}><option value="">No account selected</option><option value={player.associated_account_id}>{player.associated_account_name ?? "Previously associated account"}</option></select></label>}
    <button className="btn-secondary w-full" type="submit">Save recipient</button>
  </form>;
}
export default function TeamInvitations({ group, review = false }: { group: RosterGroup; currentUserName: string; review?: boolean }) {
  const { state, error: loadError, load, mutate } = useTeamManagement(group.id);
  const [mode, setMode] = useState<"link" | "email">("link");
  const [rows, setRows] = useState(() => [{ id: crypto.randomUUID(), name: "", email: "" }]);
  const [message, setMessage] = useState<string | null>(null); const [includeUsta, setIncludeUsta] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null); const [more, setMore] = useState<"friends" | "availability" | null>(null);
  const batch = useRef<string | null>(null);
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Could not complete action"); } finally { setBusy(false); } }
  const body = message ?? state?.config.invitationMessage ?? `You're invited to join ${group.name} on TennisFriends!`;
  const withUsta = includeUsta ?? state?.config.includeUstaInInvitations !== false;
  async function send(ids: string[]) {
    await mutate({ action: "message", message: body, includeUstaInInvitations: withUsta });
    batch.current ??= crypto.randomUUID();
    const report = z.object({ sent: z.number(), failed: z.number(), pending: z.number(), message: z.string() }).parse(await teamResponse(await fetch(`/api/team-onboarding/${group.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "email", reminder: false, batchId: batch.current, playerIds: ids }) })));
    setNotice(`${report.sent} emails accepted; ${report.failed} failed; ${report.pending} pending. ${report.message}`);
    if (!report.failed && !report.pending) { batch.current = null; setRows([{ id: crypto.randomUUID(), name: "", email: "" }]); }
    await load();
  }
  return <main className="max-w-2xl mx-auto p-4 py-6 space-y-5"><Link href={`/groups/${group.id}/roster`} className="text-sm underline text-court-green">Back to roster</Link><header><p className="text-sm text-gray-600">{group.name}</p><h1 className="font-display text-3xl font-bold text-court-green">Invite players</h1></header>
    {(error || loadError) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error || loadError}</p>}{notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-950">{notice}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div role="group" aria-label="Invitation method" className="grid grid-cols-2 gap-3"><button type="button" aria-pressed={mode === "link"} className={mode === "link" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("link")}>Share team link</button><button type="button" aria-pressed={mode === "email"} className={mode === "email" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("email")}>Send by email</button></div>
      {mode === "link" && <section className="rounded-2xl border bg-white p-4">{state ? <TeamSharedInvitations view="link" groupId={group.id} players={[]} onApproved={async () => { await load(); }} onBusyChange={setBusy} /> : <p className="text-sm">{loadError ? "Invitations could not be loaded." : "Loading invitations…"}</p>}</section>}
      {mode === "email" && state && <section className="rounded-2xl border bg-white p-5 space-y-4"><h2 className="font-bold text-xl">Personal email invitations</h2><p className="text-sm text-gray-600">Each recipient receives a personal link and can accept directly. Add one or more email addresses; names are optional.</p>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void action(async () => {
          if (!body.trim()) throw new Error("Enter an invitation message");
          const recipients = z.array(recipientSchema).min(1).parse(rows.map(row => ({ ...row, name: row.name.trim() || row.email.split("@")[0].slice(0, 100) })));
          if (new Set(recipients.map(r => r.email)).size !== recipients.length) throw new Error("Use a different email for each recipient");
          await mutate({ action: "recipients", recipients }); await send(recipients.map(r => r.id));
        }); }}>
          {rows.map((row, index) => <fieldset key={row.id} className="rounded-xl border border-gray-200 p-3 space-y-3"><legend className="px-1 text-sm font-semibold">Recipient {index + 1}</legend><label className="block text-sm">Email<input className={input} required type="email" value={row.email} onChange={e => { batch.current = null; setRows(all => all.map(r => r.id === row.id ? { ...r, email: e.target.value } : r)); }} /></label><label className="block text-sm">Name (optional)<input className={input} maxLength={100} value={row.name} onChange={e => setRows(all => all.map(r => r.id === row.id ? { ...r, name: e.target.value } : r))} /></label>{rows.length > 1 && <button type="button" className="text-sm underline text-red-800" onClick={() => setRows(all => all.filter(r => r.id !== row.id))}>Remove recipient {index + 1}</button>}</fieldset>)}
          <button type="button" className="btn-secondary w-full" onClick={() => setRows(all => [...all, { id: crypto.randomUUID(), name: "", email: "" }])}>Add another email</button>
          <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold text-court-green">Customize message</summary><label className="block text-sm mt-3">Invitation message<textarea className={input} rows={4} value={body} onChange={e => { batch.current = null; setMessage(e.target.value); }} /></label></details>
          {state.config.includeUsta ? <label className="flex gap-3 text-sm"><input type="checkbox" checked={withUsta} onChange={e => setIncludeUsta(e.target.checked)} />Include USTA instructions in email</label> : <p className="text-sm text-gray-600">USTA registration is optional. <Link className="underline text-court-green" href={`/groups/${group.id}/registration`}>Set it up separately</Link>.</p>}
          <button className="btn-primary h-12 w-full" type="submit">{busy ? "Sending…" : "Send invitations"}</button>
        </form>
      </section>}
      {state && (state.players.some(p => !p.accepted_by) || state.legacyInvitations.length > 0) && <section className="rounded-2xl border bg-white p-5 space-y-4"><h2 className="text-xl font-bold">Pending invitations</h2><ul className="divide-y">{state.players.filter(p => !p.accepted_by).map(p => <li key={p.id} className="py-4 space-y-3"><strong className="break-words">{p.name}</strong><p className="text-sm break-all">{p.email}</p><p className="text-sm text-gray-600">{p.revoked_at ? "Invitation revoked" : p.sent_at ? "Invitation issued" : "Invitation not issued"}</p>
        {p.email && !p.revoked_at && <button className="btn-secondary w-full" type="button" onClick={() => void action(() => send([p.id]))}>Send email to {p.name}</button>}
        {(p.sent_at || p.revoked_at) && <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold text-court-green" aria-label={`Manage invitation for ${p.name}`}>Manage invitation</summary><div className="space-y-3 pt-3"><button className="btn-secondary w-full" type="button" onClick={() => void action(async () => { await teamResponse(await fetch(`/api/team-onboarding/${group.id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: p.id, renew: true }) })); batch.current = null; await load(); setNotice("New personal link prepared. Send an email to issue it; the old link no longer works."); })}>Prepare new invitation link</button>{!p.revoked_at && <button type="button" className="text-sm underline text-red-800" onClick={() => void action(async () => { await teamResponse(await fetch(`/api/team-onboarding/${group.id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: p.id }) })); await load(); })}>Revoke invitation</button>}</div></details>}
        {(!p.sent_at || p.revoked_at) && <button className="text-sm underline text-court-green" type="button" onClick={() => setEditing(editing === p.id ? null : p.id)}>Edit recipient for {p.name}</button>}
        {editing === p.id && <RecipientEditor player={p} save={change => action(async () => { await mutate({ action: "recipient", playerId: p.id, ...change }); setEditing(null); setNotice("Recipient updated."); })} />}
      </li>)}{state.legacyInvitations.map(i => <li key={i.id} className="py-4 space-y-3"><p className="text-sm break-all">{i.email ?? "Previously shared personal invitation"}</p><p className="text-xs text-gray-600">Existing invitation · {i.roles.length ? i.roles.join(" · ") : "Member"}{i.memberType ? ` · ${i.memberType}` : ""}</p><button className="btn-secondary w-full" type="button" onClick={() => void action(async () => { await navigator.clipboard.writeText(`${window.location.origin}/invite/${i.token}`); setNotice("Existing invitation link copied."); })}>Copy existing invitation link</button><button className="text-sm underline text-red-800" type="button" onClick={() => void action(async () => { await mutate({ action: "cancel-legacy", inviteId: i.id }); })}>Cancel existing invitation</button></li>)}</ul></section>}
      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-court-green">More ways to add people</summary><div className="space-y-4 pt-4"><div className="grid gap-3"><button type="button" className="btn-secondary" onClick={() => setMore(more === "friends" ? null : "friends")}>Add an existing friend</button><button type="button" className="btn-secondary" onClick={() => setMore(more === "availability" ? null : "availability")}>Track availability without an account</button></div>{more && review && <p className="text-sm text-gray-600">Friend and guest actions are disabled in this isolated preview.</p>}{more === "friends" && !review && <AddFriendsPanel groupId={group.id} existingMemberUserIds={(state?.members ?? group.members).map(m => m.userId).filter((id): id is string => Boolean(id))} onAdded={() => { void load(); }} />}{more === "availability" && !review && <InvitePlayersPanel groupId={group.id} groupName={group.name} scope="all" onChanged={() => { void load(); }} />}</div></details>
    </fieldset>
  </main>;
}
