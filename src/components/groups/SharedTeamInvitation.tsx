"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { sharedTeamInvitationSchema } from "@/lib/onboarding/shared";

type Props = { token: string; info: z.infer<typeof sharedTeamInvitationSchema>; viewer: { name: string; email: string | null } | null };
export default function SharedTeamInvitation({ token, info, viewer }: Props) {
  const router = useRouter();
  const [current, setCurrent] = useState(info);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = `/join-team/${token}`;
  async function request(method: "GET" | "POST") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/team-join/${token}`, { method, cache: "no-store" });
      const raw: unknown = await response.json();
      const parsed = sharedTeamInvitationSchema.safeParse(raw);
      if (!response.ok || !parsed.success) throw new Error("This link is unavailable or your session expired. Sign in again or ask your captain for the current link.");
      setCurrent(parsed.data);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not check your request"); }
    finally { setBusy(false); }
  }
  async function switchAccount() {
    setBusy(true); setError("");
    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (error) throw error;
      router.push(`/login?next=${encodeURIComponent(next)}`); router.refresh();
    } catch { setError("Could not sign out. Try again."); setBusy(false); }
  }
  return <main className="max-w-lg mx-auto p-4 py-8"><section className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
    <h1 className="font-display text-2xl font-bold text-court-green break-words">Join {current.name}</h1>
    {current.description && <p className="whitespace-pre-wrap break-words">{current.description}</p>}
    <p className="text-sm text-gray-700">Captain approval is required. Opening this link or submitting a request does not add you to the team.</p>
    {viewer && <p className="text-sm break-words">Signed in as <strong>{viewer.name}</strong>{viewer.email ? ` (${viewer.email})` : ""}.</p>}
    {!viewer || current.status === "signed_out" ? <Link className="btn-primary block text-center" href={`/login?next=${encodeURIComponent(next)}`}>Sign in to request to join</Link> : current.status === "joined" ? <><p role="status">You’re a member of this team.</p><Link className="btn-primary block text-center" href={`/groups/${current.groupId}`}>Open team</Link></> : current.status === "pending" ? <><p role="status">Request sent. Waiting for captain approval.</p><button className="btn-secondary w-full" disabled={busy} onClick={() => void request("GET")}>{busy ? "Checking…" : "Check approval status"}</button></> : current.status === "rejected" || current.status === "removed" ? <p role="status">{current.status === "rejected" ? "Your request was not approved." : "You no longer have team access."} Contact the captain if you need help.</p> : <button className="btn-primary w-full" disabled={busy} onClick={() => void request("POST")}>{busy ? "Sending request…" : "Request to join"}</button>}
    {viewer && <button className="btn-secondary w-full" disabled={busy} onClick={() => void switchAccount()}>Switch account</button>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
  </section></main>;
}
