"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import TeamSharedInvitations from "./TeamSharedInvitations";
import TeamSetupProgress from "./TeamSetupProgress";
import AddFriendsPanel from "./AddFriendsPanel";
import InvitePlayersPanel from "./InvitePlayersPanel";
import { useTeamManagement, teamResponse } from "./useTeamManagement";
import type { RosterGroup } from "./TeamRoster";
import { recipientSchema, smsRecipientSchema, teamManagementMutationSchema, invitationOptionsSchema, type TeamManagementState, smsSetupError } from "@/lib/onboarding/management";
import type { storedPlayerSchema } from "@/lib/onboarding/contracts";
type Channel = "sms" | "email";
type RecipientRow = { id: string; name: string; contact: string };
const blankRow = (): RecipientRow => ({ id: crypto.randomUUID(), name: "", contact: "" });
type Player = z.infer<typeof storedPlayerSchema>;
const isExpired = (player: Player) => Date.parse(player.expires_at) <= Date.now();
const input = "mt-1 w-full rounded-xl border border-gray-300 p-3 text-base";
function RecipientEditor({ player, save }: { player: Player; save: (change: { name: string; email: string; associatedAccountId: string | null; phone?: string }) => Promise<void> }) {
  const [name, setName] = useState(player.name); const [email, setEmail] = useState(player.email ?? "");
  const [phone, setPhone] = useState(player.phone ?? "");
  const [associatedAccountId, setAccount] = useState(player.associated_account_id);
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); void save({ name, email, associatedAccountId, ...(player.phone ? { phone } : {}) }); }}>
    <label className="block text-sm">Name<input required className={input} value={name} onChange={e => setName(e.target.value)} /></label>
    {player.phone && <label className="block text-sm">Phone number<input required type="tel" className={input} value={phone} onChange={e => setPhone(e.target.value)} /></label>}
    <label className="block text-sm">Email<input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} /></label>
    {player.associated_account_id && <label className="block text-sm">Associated account<select className={input} value={associatedAccountId ?? ""} onChange={e => setAccount(e.target.value || null)}><option value="">No account selected</option><option value={player.associated_account_id}>{player.associated_account_name ?? "Previously associated account"}</option></select></label>}
    <button className="btn-secondary w-full" type="submit">Save recipient</button>
  </form>;
}
type InvitationsProps = { group: RosterGroup; currentUserName: string; review?: boolean; setup?: boolean; fromSettings?: boolean; initialState?: TeamManagementState };
export default function TeamInvitations(props: InvitationsProps) {
  return <LoadedInvitations key={props.group.id} {...props} />;
}
function LoadedInvitations(props: InvitationsProps) {
  const management = useTeamManagement(props.group.id, props.initialState);
  const [busy, setBusy] = useState(false);
  const keyboardHeight = useKeyboardHeight();
  const teamHref = `/groups/${props.group.id}`;
  const rosterHref = props.fromSettings ? `${teamHref}/settings?tab=roster` : `${teamHref}/roster`;
  const setupInset = keyboardHeight > 0 ? `${keyboardHeight}px` : "var(--native-tab-bar-height, 0px)";
  const setupSafeArea = keyboardHeight > 0
    ? "0px"
    : "max(0px, calc(env(safe-area-inset-bottom, 0px) - var(--native-tab-bar-height, 0px)))";
  // Reserve room for the setup bar and what it sits above, even when the
  // keyboard handler clears the body's own bottom padding.
  const setupBottomPadding = `calc(6rem + ${setupInset} + ${setupSafeArea})`;
  return <main
    className="max-w-2xl mx-auto p-4 py-6 space-y-5"
    style={props.setup ? { paddingBottom: setupBottomPadding } : undefined}
  >
    {!props.setup && <Link href={rosterHref} className="text-sm underline text-court-green">Back to roster</Link>}
    <header><p className="text-sm text-gray-600">{props.group.name}</p><h1 className="font-display text-3xl font-bold text-court-green">Invite players</h1></header>
    {props.setup && (
      <>
        <TeamSetupProgress step={2} />
        <p className="text-sm text-gray-600">Your team is ready. You can invite players from the roster later.</p>
      </>
    )}
    {management.state ? (
      <InvitationsEditor {...props} management={{ ...management, state: management.state }} busy={busy} setBusy={setBusy} />
    ) : (
      <p role={management.error ? "alert" : "status"}>{management.error || "Loading invitations…"}</p>
    )}
    {props.setup && (
      <nav
        aria-label="Setup navigation"
        className="fixed inset-x-0 z-30 border-t border-gray-200 bg-white pt-3"
        style={{
          bottom: setupInset,
          paddingBottom: `calc(0.75rem + ${setupSafeArea})`,
        }}
      >
        <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 px-4">
          {busy ? (
            <>
              <button type="button" disabled className="btn-secondary h-12 w-full">Back</button>
              <button type="button" disabled className="btn-primary h-12 w-full">Go to team</button>
            </>
          ) : (
            <>
              <Link href={`${teamHref}/setup-details`} className="btn-secondary h-12 w-full text-center">Back</Link>
              <Link href={teamHref} replace prefetch={false} className="btn-primary h-12 w-full text-center">Go to team</Link>
            </>
          )}
        </div>
      </nav>
    )}
  </main>;
}
function InvitationsEditor({ group, review = false, setup = false, management, busy, setBusy }: InvitationsProps & {
  management: ReturnType<typeof useTeamManagement> & { state: TeamManagementState };
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const router = useRouter();
  const { state, error: loadError, load, mutate } = management;
  // A roster reload must not replace this tab's draft with another captain's preferences.
  const [initialConfig] = useState(state.config);
  const [mode, setMode] = useState<Channel | "link">("sms");
  const [drafts, setDrafts] = useState<Record<Channel, RecipientRow[]>>(() => ({ sms: [blankRow()], email: [blankRow()] }));
  const [smsConsent, setSmsConsent] = useState(false);
  const [pendingSmsConsent, setPendingSmsConsent] = useState<Record<string, string>>({});
  const channel: Channel = mode === "email" ? "email" : "sms";
  const rows = drafts[channel];
  function setRows(next: (all: RecipientRow[]) => RecipientRow[], recipientChanged = false) {
    if (channel === "sms" && recipientChanged) setSmsConsent(false);
    setDrafts(all => ({ ...all, [channel]: next(all[channel]) }));
  }
  const [message, setMessage] = useState<string | null>(null); const [includeUsta, setIncludeUsta] = useState<boolean | null>(null);
  const [ustaDraft, setUstaDraft] = useState<{ ustaTeamName: string; teamNumber: string; deadline: string; includeRegistrationLink: boolean } | null>(null);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<string | null>(null); const [more, setMore] = useState<"friends" | "availability" | null>(null);
  const batches = useRef<Record<string, string>>({});
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(""); setNotice(""); try { await work(); } catch (e) { setError(e instanceof z.ZodError ? e.issues[0]?.message ?? "Check the invitation details" : e instanceof Error ? e.message : "Could not complete action"); } finally { setBusy(false); } }
  async function renewInvitation(playerId: string) {
    await teamResponse(await fetch(`/api/team-onboarding/${group.id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId, renew: true }) }));
    batches.current = {};
    await load();
    setNotice("New personal link prepared. Send an SMS or email to issue it; the old link no longer works.");
  }
  const body = message ?? initialConfig.invitationMessage ?? `You're invited to join ${group.name} on TennisFriends!`;
  const withUsta = includeUsta ?? Boolean(initialConfig.includeUsta && initialConfig.includeUstaInInvitations !== false);
  const usta = ustaDraft ?? { ustaTeamName: initialConfig.ustaTeamName ?? group.name, teamNumber: initialConfig.teamNumber ?? "", deadline: initialConfig.deadline ?? "", includeRegistrationLink: initialConfig.includeRegistrationLink !== false };
  function registrationChange() {
    if (!withUsta) return null;
    return teamManagementMutationSchema.parse({ action: "registration", includeUsta: true, ...usta });
  }
  async function send(ids: string[], delivery: Channel, {
    finish = false,
    source,
    consent,
  }: { finish?: boolean; source?: TeamManagementState; consent?: ReadonlyMap<string, string> } = {}) {
    const current = source ?? await load();
    const recipients = [...ids].sort().map(id => {
      const p = current.players.find(p => p.id === id);
      if (!p) throw new Error("Refresh the team before sending this invitation");
      return { id, phone: p.phone, email: p.email, token: p.token, associatedAccountId: p.associated_account_id };
    });
    if (delivery === "sms") {
      const setupError = smsSetupError(current);
      if (setupError) throw new Error(setupError);
      if (recipients.some(p => !p.phone || consent?.get(p.id) !== p.phone)) {
        throw new Error("Confirm permission to text the current numbers before sending.");
      }
    }
    const registration = registrationChange();
    if (registration && (!state?.config.includeUsta || ustaDraft !== null)) await mutate(registration);
    const invitation = invitationOptionsSchema.parse({ message: body, includeUsta: withUsta, ...(withUsta ? { registration: usta } : {}) });
    const batchKey = JSON.stringify({ ids: [...ids].sort(), delivery, body, withUsta, usta: withUsta ? usta : null, recipients });
    batches.current[batchKey] ??= crypto.randomUUID();
    const report = z.object({ sent: z.number(), failed: z.number(), pending: z.number(), message: z.string() }).parse(await teamResponse(await fetch(`/api/team-onboarding/${group.id}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: delivery, smsConsent: delivery === "sms" ? true : undefined, reminder: false, invitation, recipients, batchId: batches.current[batchKey], playerIds: ids }) })));
    setNotice(`${report.sent} ${delivery === "sms" ? "texts" : "emails"} accepted; ${report.failed} failed; ${report.pending} pending. ${report.message}`);
    if (!report.failed && !report.pending) {
      delete batches.current[batchKey];
      if (finish) { setDrafts(all => ({ ...all, [delivery]: [blankRow()] })); setSmsConsent(false); }
    }
    if (setup && finish && !report.failed && !report.pending) {
      router.replace(`/groups/${group.id}`);
      router.refresh();
      return;
    }
    await load();
  }
  function setRecipientConsent(player: Player, checked: boolean) {
    setPendingSmsConsent(previous => ({
      ...previous, [player.id]: checked ? `${player.token}:${player.phone}` : "",
    }));
  }

  async function sendPendingSms(player: Player) {
    if (!player.phone || pendingSmsConsent[player.id] !== `${player.token}:${player.phone}`) return;
    setRecipientConsent(player, false);
    await send([player.id], "sms", { consent: new Map([[player.id, player.phone]]) });
  }

  return <>
    {(error || loadError) && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error || loadError}</p>}{notice && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-950">{notice}</p>}
    <fieldset disabled={busy} className="min-w-0 space-y-5">
      <div role="group" aria-label="Invitation method" className="grid grid-cols-2 gap-3"><button type="button" aria-pressed={mode === "sms"} className={mode === "sms" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("sms")}>Send by SMS</button><button type="button" aria-pressed={mode === "email"} className={mode === "email" ? "btn-primary" : "btn-secondary"} onClick={() => setMode("email")}>Send by email</button></div>
      <button type="button" aria-pressed={mode === "link"} className="text-sm font-semibold underline text-court-green" onClick={() => setMode("link")}>Share a team link instead</button>
      {mode === "link" && <section className="rounded-2xl border bg-white p-4">{state ? <TeamSharedInvitations view="link" groupId={group.id} players={[]} onApproved={async () => { await load(); }} onBusyChange={setBusy} /> : <p className="text-sm">{loadError ? "Invitations could not be loaded." : "Loading invitations…"}</p>}</section>}
      {mode === "sms" && state.delivery && smsSetupError(state) && <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{smsSetupError(state)}</p>}
      {mode !== "link" && state && <section className="rounded-2xl border bg-white p-5 space-y-4"><h2 className="font-bold text-xl">{channel === "sms" ? "Text invitations" : "Personal email invitations"}</h2><p className="text-sm text-gray-600">TennisFriends sends each player a personal invitation link. They sign in and accept to join. {channel === "sms" ? "Enter phone numbers; names are optional. Use +country code outside the US or Canada." : "Enter email addresses; names are optional."}</p>
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void action(async () => {
          if (!body.trim()) throw new Error("Enter an invitation message");
          registrationChange();
          if (channel === "sms") {
            if (!smsConsent) throw new Error("Confirm these players agreed to receive this invitation by SMS");
            const recipients = z.array(smsRecipientSchema).min(1).parse(rows.map(row => ({ id: row.id, name: row.name.trim() || `Player · ${row.contact.replace(/\D/g, "").slice(-4)}`, phone: row.contact })));
            if (new Set(recipients.map(r => r.phone)).size !== recipients.length) throw new Error("Use a different phone number for each player");
            const current = await load();
            const prepared = recipients.map((r, index) => {
              const existing = current.players.find(p => p.id === r.id) ?? current.players.find(p => p.phone === r.phone && !p.revoked_at && !p.accepted_by && !p.sent_at);
              return { ...r, id: existing?.id ?? r.id, name: rows[index].name.trim() || existing?.name || r.name };
            });
            setRows(all => all.map((row, index) => ({ ...row, id: prepared[index].id })));
            const setupError = smsSetupError(current); if (setupError) throw new Error(setupError);
            const next = await mutate({ action: "sms-recipients", recipients: prepared });
            const ids = prepared.map(r => { const p = next.players.find(p => p.phone === r.phone && !p.revoked_at && !p.accepted_by); if (!p) throw new Error("Refresh the team and review this contact before sending"); return p.id; });
            setRows(all => all.map((row, index) => ({ ...row, id: ids[index] })));
            const consent = new Map(ids.map((id, index) => [id, prepared[index].phone]));
            await send(ids, "sms", { finish: true, source: next, consent });
          } else {
            const recipients = z.array(recipientSchema).min(1).parse(rows.map(row => ({ id: row.id, name: row.name.trim() || row.contact.split("@")[0].slice(0, 100), email: row.contact })));
            if (new Set(recipients.map(r => r.email)).size !== recipients.length) throw new Error("Use a different email for each recipient");
            const next = await mutate({ action: "recipients", recipients }); await send(recipients.map(r => r.id), "email", { finish: true, source: next });
          }
        }); }}>
          {rows.map((row, index) => <fieldset key={row.id} className="rounded-xl border border-gray-200 p-3 space-y-3"><legend className="px-1 text-sm font-semibold">Recipient {index + 1}</legend><label className="block text-sm">{channel === "sms" ? "Phone number" : "Email"}<input className={input} required type={channel === "sms" ? "tel" : "email"} autoComplete={channel === "sms" ? "tel" : "email"} value={row.contact} onChange={e => setRows(all => all.map(r => r.id === row.id ? { ...r, contact: e.target.value } : r), true)} /></label><label className="block text-sm">Name (optional)<input className={input} maxLength={100} value={row.name} onChange={e => setRows(all => all.map(r => r.id === row.id ? { ...r, name: e.target.value } : r))} /></label>{rows.length > 1 && <button type="button" className="text-sm underline text-red-800" onClick={() => setRows(all => all.filter(r => r.id !== row.id), true)}>Remove recipient {index + 1}</button>}</fieldset>)}
          <button type="button" className="btn-secondary w-full" onClick={() => setRows(all => [...all, blankRow()], true)}>{channel === "sms" ? "Add another phone number" : "Add another email"}</button>
          <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold text-court-green">Customize message</summary><label className="block text-sm mt-3">Invitation message<textarea className={input} rows={4} value={body} onChange={e => setMessage(e.target.value)} /></label></details>
          <fieldset className="rounded-xl border border-gray-200 p-4 space-y-4 min-w-0">
            <legend className="px-1 text-sm font-semibold">USTA registration (optional)</legend>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={withUsta} onChange={e => setIncludeUsta(e.target.checked)} />Include USTA registration instructions</label>
            {withUsta && <><p className="text-sm text-gray-600">Add the team number and deadline to each invitation. These details are saved when you send; manage registration and confirmations from Roster.</p>
              <label className="block text-sm">USTA team name<input className={input} maxLength={100} value={usta.ustaTeamName} onChange={e => setUstaDraft({ ...usta, ustaTeamName: e.target.value })} /></label>
              <label className="block text-sm">USTA team number<input className={input} inputMode="numeric" required pattern="[0-9]{10}" maxLength={10} value={usta.teamNumber} onChange={e => setUstaDraft({ ...usta, teamNumber: e.target.value })} /></label>
              <label className="block text-sm">Registration deadline<input className={input} type="date" required value={usta.deadline} onChange={e => setUstaDraft({ ...usta, deadline: e.target.value })} /></label>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={usta.includeRegistrationLink} onChange={e => setUstaDraft({ ...usta, includeRegistrationLink: e.target.checked })} />Include USTA registration link in invitation</label>
            </>}
          </fieldset>
          {channel === "sms" && <div className="space-y-2"><label className="flex items-start gap-3 text-sm"><input required type="checkbox" className="mt-1" checked={smsConsent} onChange={e => setSmsConsent(e.target.checked)} />These players agreed to receive this team invitation by text.</label><p className="text-sm text-gray-600">Before sending, use the <Link href="/sms-consent" target="_blank" rel="noopener noreferrer" className="font-semibold text-court-green underline">verbal consent script (opens in a new tab)</Link> and keep a dated record of each player&apos;s permission.</p></div>}
          <button className="btn-primary h-12 w-full" type="submit">{busy ? "Sending…" : setup ? "Send invitations & finish" : channel === "sms" ? "Send SMS invitations" : "Send invitations"}</button>
        </form>
      </section>}
      {state && (state.players.some(p => !p.accepted_by) || state.legacyInvitations.length > 0) && <section className="rounded-2xl border bg-white p-5 space-y-4"><h2 className="text-xl font-bold">Pending invitations</h2><ul className="divide-y">{state.players.filter(p => !p.accepted_by).map(p => <li key={p.id} className="py-4 space-y-3"><strong className="break-words">{p.name}</strong><p className="text-sm break-all">{[p.phone, p.email].filter(Boolean).join(" · ")}</p><p className="text-sm text-gray-600">{p.revoked_at ? "Invitation revoked" : p.sent_at ? "Invitation issued" : "Invitation not issued"}</p>
        {!p.sent_at && !p.revoked_at && isExpired(p) && <div className="space-y-3"><p className="text-sm text-amber-900">This invitation expired before it was issued. Renew it before sending; the player and registration history will be kept.</p><button className="btn-secondary w-full" type="button" onClick={() => void action(() => renewInvitation(p.id))}>Renew expired invitation for {p.name}</button></div>}
        {p.phone && !p.revoked_at && !isExpired(p) && <div className="space-y-2">
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={pendingSmsConsent[p.id] === `${p.token}:${p.phone}`} onChange={e => setRecipientConsent(p, e.target.checked)} />{p.name} agreed to receive this invitation by text.</label>
          <button className="btn-secondary w-full" type="button" disabled={pendingSmsConsent[p.id] !== `${p.token}:${p.phone}`} onClick={() => void action(() => sendPendingSms(p))}>Send SMS to {p.name}</button>
        </div>}
        {p.email && !p.revoked_at && !isExpired(p) && <button className="btn-secondary w-full" type="button" onClick={() => void action(() => send([p.id], "email"))}>Send email to {p.name}</button>}
        {(p.sent_at || p.revoked_at) && <details className="rounded-xl border p-3"><summary className="cursor-pointer text-sm font-semibold text-court-green" aria-label={`Manage invitation for ${p.name}`}>Manage invitation</summary><div className="space-y-3 pt-3"><button className="btn-secondary w-full" type="button" onClick={() => void action(() => renewInvitation(p.id))}>Prepare new invitation link</button>{!p.revoked_at && <button type="button" className="text-sm underline text-red-800" onClick={() => void action(async () => { await teamResponse(await fetch(`/api/team-onboarding/${group.id}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerId: p.id }) })); await load(); })}>Revoke invitation</button>}</div></details>}
        {(!p.sent_at || p.revoked_at) && <button className="text-sm underline text-court-green" type="button" onClick={() => setEditing(editing === p.id ? null : p.id)}>Edit recipient for {p.name}</button>}
        {editing === p.id && <RecipientEditor player={p} save={change => action(async () => { await mutate({ action: "recipient", playerId: p.id, ...change }); setEditing(null); setNotice("Recipient updated."); })} />}
      </li>)}{state.legacyInvitations.map(i => <li key={i.id} className="py-4 space-y-3"><p className="text-sm break-all">{i.email ?? "Previously shared personal invitation"}</p><p className="text-xs text-gray-600">Existing invitation · {i.roles.length ? i.roles.join(" · ") : "Member"}{i.memberType ? ` · ${i.memberType}` : ""}</p><button className="btn-secondary w-full" type="button" onClick={() => void action(async () => { await navigator.clipboard.writeText(`${window.location.origin}/invite/${i.token}`); setNotice("Existing invitation link copied."); })}>Copy existing invitation link</button><button className="text-sm underline text-red-800" type="button" onClick={() => void action(async () => { await mutate({ action: "cancel-legacy", inviteId: i.id }); })}>Cancel existing invitation</button></li>)}</ul></section>}
      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer text-sm font-semibold text-court-green">More ways to add people</summary><div className="space-y-4 pt-4"><div className="grid gap-3"><button type="button" className="btn-secondary" onClick={() => setMore(more === "friends" ? null : "friends")}>Add an existing friend</button><button type="button" className="btn-secondary" onClick={() => setMore(more === "availability" ? null : "availability")}>Track availability without an account</button></div>{more && review && <p className="text-sm text-gray-600">Friend and guest actions are disabled in this isolated preview.</p>}{more === "friends" && !review && <AddFriendsPanel groupId={group.id} existingMemberUserIds={(state?.members ?? group.members).map(m => m.userId).filter((id): id is string => Boolean(id))} onAdded={() => { void load(); }} />}{more === "availability" && !review && <InvitePlayersPanel groupId={group.id} groupName={group.name} scope="all" onChanged={() => { void load(); }} />}</div></details>
    </fieldset>
  </>;
}
