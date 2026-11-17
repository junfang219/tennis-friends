"use client";

import { useId, useState } from "react";
import { prepareRegistrationPlayer, registrationChannels, associateRegistrationAccount, type RegistrationPlayer } from "@/lib/registrationOnboarding";

import { REVIEW_FRIEND_ACCOUNTS } from "@/lib/registrationReviewAccounts";

const input = "mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-court-green";
export default function RegistrationPlayers({ players, onChange, friendAccounts, friendsLoading = false, friendsError = "", review = true }: { players: RegistrationPlayer[]; onChange: (players: RegistrationPlayer[]) => void; friendAccounts?: { id: string; name: string }[]; friendsLoading?: boolean; friendsError?: string; review?: boolean }) {
  const accounts = friendAccounts ?? (review ? REVIEW_FRIEND_ACCOUNTS : []);
  const contactHintId = useId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [associatedId, setAssociatedId] = useState("");
  const [error, setError] = useState("");
  function add(value: { name: string; phone: string; email: string }) {
    try {
      const player = prepareRegistrationPlayer({ ...value, id: crypto.randomUUID() }, players);
      const account = accounts.find(a => a.id === associatedId);
      const updated = [...players, player];
      onChange(account ? associateRegistrationAccount(updated, player.id, account) : updated); setAssociatedId(""); setError(""); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Check this player's details."); return false; }
  }
  return <div className="space-y-4">
    <h2 className="text-xl font-bold">Who do you plan to play with?</h2>
    <p className="text-sm text-gray-600">Add the players you want to invite to your team. They don’t need a TennisFriends account yet.</p>
    <form className="space-y-3 rounded-xl border border-gray-200 p-4" onSubmit={e => { e.preventDefault(); if (add({ name, phone, email })) { setName(""); setPhone(""); setEmail(""); } }}>
      <label className="block text-sm font-semibold">Player name<input required className={input} value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="First and last name" /></label>
      <fieldset aria-describedby={contactHintId} className="space-y-3 rounded-xl bg-surface p-3"><legend className="px-1 text-sm font-semibold">Invitation contact</legend>
        <p id={contactHintId} className="text-sm text-gray-700">Add a phone number, email address, or both. Only one is needed to invite this player.</p>
        <label className="block text-sm font-semibold">Phone number<input type="tel" className={input} value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" placeholder="(206) 555-0101" /></label>
        <label className="block text-sm font-semibold">Email<input type="email" className={input} value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="player@example.com" /></label>
        <p className="text-xs text-gray-600">Adding a player won’t send an invitation. {review && "Sending is simulated in this preview."}</p>
      </fieldset>
      <label className="block text-sm font-semibold">Associate a friend account (optional)<select disabled={friendsLoading} className={input} value={associatedId} onChange={e => setAssociatedId(e.target.value)}><option value="">{friendsLoading ? "Loading friends…" : "No account selected"}</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {friendsError && <p role="status" className="text-sm text-gray-600">{friendsError}</p>}
      <p className="text-xs text-gray-600">{review ? "Fictional friend accounts for this review. " : "Select an existing friend if you know their account. "}Selecting an account helps identify the player; it does not accept their invitation. You can still share the invitation through your own Messages app.</p>
      <button className="btn-secondary w-full" type="submit">Add player</button>
    </form>
    <p className="text-sm text-gray-600">When a player opens their personal invitation and signs in or creates an account and accepts the invitation, the app links their account to this roster entry. USTA registration and joining TennisFriends are tracked separately.</p>
    {review && <p className="text-xs text-gray-600">Sign-in and invitation acceptance will be connected before release. This local review does not look up accounts or join anyone to a live team.</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    <h3 className="font-semibold">Intended roster ({players.length})</h3>
    {!players.length && <p className="text-sm text-gray-600">No players added yet.</p>}
    <ul className="divide-y divide-gray-200">{players.map(p => <li key={p.id} className="py-3 space-y-1"><div className="flex justify-between gap-2"><strong className="break-words min-w-0">{p.name}</strong><button type="button" className="text-sm text-red-800 underline shrink-0" aria-label={`Remove ${p.name}`} onClick={() => onChange(players.filter(other => other.id !== p.id))}>Remove</button></div><p className="text-sm text-gray-600 break-all">{[p.phone, p.email].filter(Boolean).join(" · ")}</p><p className="text-xs text-court-green font-semibold">{registrationChannels(p)}</p><p className="text-xs text-gray-600">{p.memberId ? "Joined team" : p.associatedAccountId ? `Account associated: ${p.associatedAccountName} · Invitation not accepted` : "No account associated yet"}</p>{!p.memberId && <label className="block text-sm">Associate account for {p.name}<select className={input} value={p.associatedAccountId ?? ""} onChange={e => { try { onChange(associateRegistrationAccount(players, p.id, accounts.find(a => a.id === e.target.value) ?? null)); setError(""); } catch (err) { setError(err instanceof Error ? err.message : "Could not associate account."); } }}><option value="">No account selected</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}</li>)}</ul>
  </div>;
}
