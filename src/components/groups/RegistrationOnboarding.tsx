"use client";

import { useEffect, useRef, useState } from "react";
import { blankRegistrationDraft, formatDeadline, invitationIssues, registrationChannels, registrationDraftSchema, registrationMessage, REGISTRATION_URL, type RegistrationDraft } from "@/lib/registrationOnboarding";
import RegistrationPlayers from "./RegistrationPlayers";
import RegistrationAcceptancePreview from "./RegistrationAcceptancePreview";

const STORAGE_KEY = "tennisfriend:registration-review:v1";
const input = "mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-court-green";
const steps = ["Team details", "Players", "Invitations", "Team overview"];

export default function RegistrationOnboarding() {
  const [draft, setDraft] = useState<RegistrationDraft>(blankRegistrationDraft);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [playerView, setPlayerView] = useState(false);
  const [previewPlayerId, setPreviewPlayerId] = useState("");
  const [reminder, setReminder] = useState(false);
  const [origin, setOrigin] = useState("");
  const deadlineRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Hydrate browser-only local review data after SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrigin(window.location.origin);
    setPlayerView(window.location.hash === "#player");
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = registrationDraftSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          const old = parsed.data;
          setDraft({ ...old, includeUsta: old.includeUsta ?? Boolean(old.teamNumber), players: old.players.map(p => p.memberId?.startsWith("review-member-") ? { ...p, memberId: null } : p) });
          if (old.players.some(p => p.invitedAt)) setStep(3);
        }
      }
    } catch { setNotice("Could not load the saved draft. You can start a new one."); }
    setReady(true);
  }, []);
  const teamLink = `${origin}/onboarding-preview#player`;
  const previewPlayer = draft.players.find(p => p.id === previewPlayerId) ?? draft.players[0];
  const messageBody = draft.invitationMessage ?? `You're invited to join ${draft.name} on TennisFriends!`;
  const missing = draft.players.filter(p => !p.confirmedAt);
  const patch = (value: Partial<RegistrationDraft>) => setDraft(d => ({ ...d, ...value }));
  const currentDraft = () => step === 2 && draft.includeUsta ? { ...draft, deadline: deadlineRef.current?.value ?? draft.deadline } : draft;
  function persist(value = currentDraft()) {
    const parsed = registrationDraftSchema.safeParse(value);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return false; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.data)); setDraft(parsed.data); return true; }
    catch { setError("Could not save your draft. Browser storage may be unavailable."); return false; }
  }
  function next() {
    setError(""); setNotice("");
    if (step === 1 && !draft.players.length) { setError("Add at least one player to continue."); return; }
    if (persist()) setStep(s => s + 1);
  }
  function send(isReminder: boolean) {
    const value = currentDraft();
    const issues = invitationIssues(value);
    if (issues.length) { setError(issues.join(" ")); return; }
    const now = new Date().toISOString();
    const updated = { ...value, players: value.players.map(p => isReminder ? (!p.confirmedAt ? { ...p, remindedAt: now } : p) : { ...p, invitedAt: now }) };
    if (!persist(updated)) return;
    setError(""); setReminder(false); setStep(3);
    setNotice(`Simulated ${isReminder ? "USTA reminders" : "invitations"} for ${isReminder ? missing.length : draft.players.length} players. No messages were sent.`);
  }
  function confirm(id: string) {
    persist({ ...draft, players: draft.players.map(p => p.id === id ? { ...p, confirmedAt: p.confirmedAt ? null : new Date().toISOString() } : p) });
  }
  if (!ready) return <p className="p-6">Loading your local draft…</p>;
  return <div className="min-h-screen">
    <header className="bg-court-green text-white px-4 py-5"><div className="max-w-2xl mx-auto flex justify-between gap-3"><span className="font-display text-xl font-bold">TennisFriends</span><span className="text-xs border border-white/40 rounded-full px-3 py-1">Local review</span></div></header>
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Review mode · Drafts stay in this browser. Messages and account linking are simulated. No live team data is changed.</p>
      {playerView ? <section className="bg-white border border-gray-200 rounded-2xl p-5 space-y-5">
        <p className="text-sm font-semibold text-court-green">You’re invited to play</p><h1 className="font-display text-3xl text-court-green">{draft.name}</h1>
        {draft.description && <p className="whitespace-pre-wrap text-gray-700">{draft.description}</p>}
        {previewPlayer ? <><label className="block text-sm font-semibold">Preview invitation for<select className={input} value={previewPlayer.id} onChange={e => setPreviewPlayerId(e.target.value)}>{draft.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><RegistrationAcceptancePreview key={previewPlayer.id} player={previewPlayer} players={draft.players} teamName={draft.name} onAccepted={players => persist({ ...draft, players })} /></> : <p>No intended players yet.</p>}
        <p className="text-sm text-gray-600">Already have an account? Sign in. Otherwise, create one. Accept your personal invitation after signing in to link your account to this roster entry. Google, Apple, and email accounts work without phone verification. No friendship with the captain is needed.</p>
        {draft.includeUsta && <div className="bg-surface rounded-xl p-4 space-y-3"><h2 className="font-bold">Register for the USTA team</h2><p>{draft.ustaTeamName || draft.name}</p><p className="text-xl font-bold break-all">Team #{draft.teamNumber || "pending"}</p><p>Register by {formatDeadline(draft.deadline)}</p>{draft.includeRegistrationLink !== false && <a className="btn-secondary block text-center" href={REGISTRATION_URL} target="_blank" rel="noreferrer">Register on USTA ↗</a>}<p className="text-sm text-gray-600">USTA registration is separate from joining the app. Your captain will check the roster; no self-report is required here.</p></div>}
        {notice && <p role="status" className="text-sm text-court-green">{notice}</p>}<p className="text-xs text-gray-600">Same-browser preview only. Personal shareable invitation links will be connected before release.</p><button className="btn-secondary" onClick={() => setPlayerView(false)}>Back to captain view</button>
      </section> : <>
        <div><p className="text-sm font-semibold text-court-green">CREATE A TEAM</p><h1 className="font-display text-3xl font-bold text-court-green mt-2">{step === 3 ? "Your team overview" : "Bring your team together"}</h1><p className="text-gray-600 mt-2">Invite your players. Add USTA registration whenever you’re ready.</p></div>
        <ol className="grid grid-cols-4 gap-1" aria-label="Setup progress">{steps.map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined} className={`border-t-4 pt-2 text-xs sm:text-sm ${i <= step ? "border-court-green text-court-green font-semibold" : "border-gray-300 text-gray-600"}`}>{i + 1}. {label}</li>)}</ol>
        {notice && <p role="status" className="rounded-xl bg-green-50 text-green-900 p-3 text-sm">{notice}</p>}{error && <p role="alert" className="rounded-xl bg-red-50 text-red-800 p-3 text-sm">{error}</p>}
        <section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5">
          {step === 0 && <><h2 className="text-xl font-bold">Tell us about your team</h2><label className="block text-sm font-semibold">Team name<input className={input} value={draft.name} onChange={e => patch({ name: e.target.value })} maxLength={100} placeholder="e.g. Saturday Doubles Crew" /></label><label className="block text-sm font-semibold">Team description (optional)<textarea className={input} rows={4} maxLength={2000} value={draft.description ?? ""} onChange={e => patch({ description: e.target.value })} placeholder="Who you play with, where you play, and what your team is about" /></label></>}
          {step === 1 && <RegistrationPlayers players={draft.players} onChange={players => patch({ players })} />}
          {step === 2 && <>
            <h2 className="text-xl font-bold">Invite your players</h2><p className="text-sm text-gray-600">Invite players to join TennisFriends, with optional USTA registration instructions. Each player receives their own invitation.</p>
            <fieldset className="space-y-4 border border-gray-200 rounded-xl p-4"><legend className="font-semibold text-sm px-1">What to include</legend>
              <p className="text-sm text-gray-600">A personal join-team link is always included.</p>
              <label className="flex gap-3 items-start text-sm font-semibold"><input type="checkbox" className="mt-1" checked={Boolean(draft.includeUsta)} onChange={e => { patch({ includeUsta: e.target.checked }); setError(""); }} />Include USTA registration instructions</label>
              {draft.includeUsta && <div className="space-y-4 border-t border-gray-200 pt-4"><label className="block text-sm font-semibold">USTA team name<input className={input} value={draft.ustaTeamName ?? draft.name} onChange={e => patch({ ustaTeamName: e.target.value })} maxLength={100} /></label><label className="block text-sm font-semibold">USTA team number (required for USTA invitations)<input className={input} value={draft.teamNumber} onChange={e => patch({ teamNumber: e.target.value })} inputMode="numeric" maxLength={10} placeholder="10-digit team number" /></label><label className="block text-sm font-semibold">Registration deadline (required for USTA invitations)<input className={input} type="date" ref={deadlineRef} defaultValue={draft.deadline} onChange={e => patch({ deadline: e.target.value })} /></label><label className="flex gap-3 items-start text-sm"><input type="checkbox" className="mt-1" checked={draft.includeRegistrationLink !== false} onChange={e => patch({ includeRegistrationLink: e.target.checked })} />Include USTA registration link</label><p className="text-xs text-gray-600">Team number and deadline are required only when requesting USTA registration. You can invite players to the app now and add this task later.</p></div>}
            </fieldset>
            <label className="block text-sm font-semibold">Invitation message<textarea className={input} rows={5} maxLength={4000} value={messageBody} onChange={e => patch({ invitationMessage: e.target.value })} /></label><p className="text-xs text-gray-600">Edit your greeting above. Selected team details and links are added below automatically.</p><button className="text-sm underline text-court-green" onClick={() => patch({ invitationMessage: undefined })}>Reset to suggested message</button>
            <div className="space-y-2"><h3 className="font-semibold text-sm">Full message preview</h3><pre className="whitespace-pre-wrap break-words rounded-xl bg-surface p-4 text-sm font-sans">{registrationMessage(draft, teamLink)}</pre></div>
            <ul className="divide-y divide-gray-200">{draft.players.map(p => <li className="py-2 flex flex-wrap justify-between gap-2 text-sm" key={p.id}><strong>{p.name}</strong><span>{registrationChannels(p)}</span></li>)}</ul>
            {invitationIssues(draft).length > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950"><p className="font-semibold">Before sending</p><ul>{invitationIssues(draft).map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
          </>}
          {step === 3 && <>
            <h2 className="text-xl font-bold">{draft.name}</h2>{draft.description && <p className="text-gray-600 whitespace-pre-wrap">{draft.description}</p>}
            <div className="bg-surface rounded-xl p-4 space-y-2"><p className="font-semibold">TennisFriends onboarding: {draft.players.filter(p => p.memberId).length} / {draft.players.length} joined</p>{draft.includeUsta ? <><p className="font-semibold">USTA registration: {draft.players.length - missing.length} / {draft.players.length} confirmed</p><p className="text-sm">{draft.ustaTeamName || draft.name} · #{draft.teamNumber || "pending"} · {formatDeadline(draft.deadline)}</p></> : <p className="text-sm text-gray-600">USTA registration tracking is not enabled.</p>}</div>
            <ul className="divide-y divide-gray-200">{draft.players.map(p => <li className="py-4 space-y-2" key={p.id}><strong>{p.name}</strong><p className="text-sm text-gray-600 break-all">{[p.phone, p.email].filter(Boolean).join(" · ")}</p><p className="text-sm">TennisFriends: {p.memberId ? "Joined" : p.associatedAccountId ? "Invitation pending" : "Not joined"}</p><p className="text-xs text-gray-600">{p.associatedAccountId ? `Associated account: ${p.associatedAccountName}` : "No account associated yet"}</p>{p.invitedAt && <button className="text-sm underline text-court-green" onClick={() => { setPreviewPlayerId(p.id); setPlayerView(true); }}>Preview invitation for {p.name}</button>}{p.invitedAt && <p className="text-xs text-gray-600">Invitation simulated · {new Date(p.invitedAt).toLocaleString()}</p>}{draft.includeUsta && <><p className="text-sm">USTA: {p.confirmedAt ? "Confirmed" : "Unconfirmed"}</p><p className="text-xs text-gray-600">{p.confirmedAt ? `Captain check · ${new Date(p.confirmedAt).toLocaleString()}` : "Not checked against the official roster yet"}</p><button className="btn-secondary text-sm" aria-label={`${p.confirmedAt ? "Undo confirmation for" : "Confirm registration for"} ${p.name}`} onClick={() => confirm(p.id)}>{p.confirmedAt ? "Undo confirmation" : "Confirm from TennisLink"}</button>{p.remindedAt && <p className="text-xs text-gray-600">Reminder simulated · {new Date(p.remindedAt).toLocaleString()}</p>}</>}</li>)}</ul>
            {draft.includeUsta && <><p className="text-sm text-gray-600">Unconfirmed does not mean unregistered. Check the official roster before reminding players. Roster importing and automatic account linking are not connected in this local review.</p><button className="btn-primary w-full disabled:opacity-50" disabled={!missing.length} onClick={() => setReminder(true)}>Review USTA reminders ({missing.length})</button>{reminder && <div className="border border-gray-300 rounded-xl p-4 space-y-3"><h3 className="font-bold">Remind unconfirmed players</h3><p className="text-sm">Recipients: {missing.map(p => p.name).join(", ")}</p><pre className="whitespace-pre-wrap break-words text-sm font-sans bg-surface rounded-lg p-3">{registrationMessage(draft, teamLink, true)}</pre><button className="btn-primary w-full" onClick={() => send(true)}>Simulate reminders</button><button className="btn-secondary w-full" onClick={() => setReminder(false)}>Cancel</button></div>}</>}
            <button className="btn-secondary w-full" onClick={() => { patch({ includeUsta: true }); setStep(2); setError(""); }}>{draft.includeUsta ? "Edit invitations / USTA details" : "Add USTA registration task"}</button><button className="btn-secondary w-full" onClick={() => setStep(0)}>Edit team / players</button><button className="btn-secondary w-full" onClick={() => { if (persist()) setPlayerView(true); }}>Preview player page</button>
          </>}
          {step < 3 && <div className="space-y-3 pt-2">{step === 2 ? <button className="btn-primary w-full" onClick={() => send(false)}>Simulate sending invitations</button> : <button className="btn-primary w-full" onClick={next}>Continue</button>}<div className="flex flex-wrap justify-between gap-3">{step > 0 && <button className="text-sm underline text-court-green" onClick={() => { if (persist()) { setStep(s => s - 1); setError(""); } }}>Back</button>}<button className="text-sm underline text-court-green" onClick={() => { setError(""); if (persist()) setNotice("Draft saved in this browser."); }}>Save draft</button>{step === 2 && <button className="text-sm underline text-court-green" onClick={() => { if (persist()) setStep(3); }}>Open dashboard without sending</button>}</div></div>}
        </section><button className="text-sm underline text-gray-600" onClick={() => { if (window.confirm("Discard this local review draft?")) { try { localStorage.removeItem(STORAGE_KEY); setDraft(blankRegistrationDraft()); setStep(0); setError(""); setNotice(""); } catch { setError("Could not clear the draft."); } } }}>Discard local draft</button>
      </>}
    </main>
  </div>;
}
