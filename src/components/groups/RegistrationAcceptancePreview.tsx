"use client";

import { useState } from "react";
import { acceptRegistrationInvitation, type RegistrationPlayer } from "@/lib/registrationOnboarding";
import { REVIEW_FRIEND_ACCOUNTS } from "@/lib/registrationReviewAccounts";

const input = "mt-1 w-full border border-gray-300 rounded-xl px-3 py-3 text-base";
type ReviewAccount = { id: string; name: string; provider: string };

export default function RegistrationAcceptancePreview({ player, players, teamName, onAccepted }: { player: RegistrationPlayer; players: RegistrationPlayer[]; teamName: string; onAccepted: (players: RegistrationPlayer[]) => boolean }) {
  const [accountId, setAccountId] = useState(player.associatedAccountId ?? "new");
  const [name, setName] = useState(player.name);
  const [provider, setProvider] = useState("Google");
  const [signedIn, setSignedIn] = useState<ReviewAccount | null>(null);
  const [error, setError] = useState("");
  const mismatch = Boolean(signedIn && player.associatedAccountId && signedIn.id !== player.associatedAccountId);
  function signIn() {
    const account = REVIEW_FRIEND_ACCOUNTS.find(a => a.id === accountId);
    if (!account && !name.trim()) { setError("Enter an account name."); return; }
    setSignedIn({ id: account?.id ?? `review-new-${player.id}`, name: account?.name ?? name.trim(), provider });
    setError("");
  }
  function accept() {
    try {
      const updated = acceptRegistrationInvitation(players, player.id, signedIn, new Date().toISOString());
      if (onAccepted(updated)) setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not accept the invitation."); }
  }
  return <section className="rounded-xl border border-gray-200 p-4 space-y-3">
    <h2 className="font-bold">Invitation for {player.name}</h2>
    <p className="text-sm text-gray-600">Local simulation only. No real sign-in or team membership is created. In the app, your personal invitation link plus sign-in and acceptance will join this team. No phone verification is required.</p>
    {player.memberId ? <div role="status" className="bg-green-50 text-green-950 rounded-xl p-3 space-y-2"><p>Invitation accepted in this local review.</p><h3 className="font-semibold">My Teams (simulated)</h3><p>{teamName}</p><p className="text-sm">Your original roster entry and USTA registration status are preserved.</p></div> : !signedIn ? <>
      <h3 className="font-semibold">Sign in to accept</h3>
      <label className="block text-sm font-semibold">Account to use (simulated)<select className={input} value={accountId} onChange={e => setAccountId(e.target.value)}><option value="new">Create a new account</option>{REVIEW_FRIEND_ACCOUNTS.map(a => <option key={a.id} value={a.id}>Existing account: {a.name}</option>)}</select></label>
      {accountId === "new" && <label className="block text-sm font-semibold">Account name<input className={input} value={name} onChange={e => setName(e.target.value)} /></label>}
      <label className="block text-sm font-semibold">Sign-in method (simulated)<select className={input} value={provider} onChange={e => setProvider(e.target.value)}><option>Google</option><option>Apple</option><option>Email</option></select></label>
      <button className="btn-primary w-full" onClick={signIn}>Simulate sign-in</button>
      <p className="text-xs text-gray-600">Signing in does not accept the invitation. You’ll review and confirm joining next.</p>
    </> : <>
      <p className="text-sm">Signed in as <strong>{signedIn.name}</strong> using {signedIn.provider} (simulated).</p>
      {mismatch ? <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">This invitation is associated with {player.associatedAccountName}. Switch to that account, or ask the captain to correct the association.</p> : <><h3 className="font-semibold">Join {teamName} as {signedIn.name}?</h3><p className="text-sm text-gray-600">Accepting adds the team to your Teams page. It does not register you with USTA.</p><button className="btn-primary w-full disabled:opacity-50" disabled={!player.invitedAt} onClick={accept}>Accept invitation (simulated)</button></>}
      <button className="btn-secondary w-full" onClick={() => { setSignedIn(null); setError(""); }}>Switch account</button>
    </>}
    {!player.invitedAt && !player.memberId && <p className="text-sm text-amber-950">The captain must send this player’s invitation first.</p>}
    {!player.associatedAccountId && !player.memberId && <p className="text-xs text-gray-600">This invitation is not bound to an account. Anyone with the personal link could accept after signing in; keep it private.</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
  </section>;
}
