"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { z } from "zod";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { publicInvitationSchema } from "@/lib/onboarding/contracts";
import { REGISTRATION_URL,formatDeadline } from "@/lib/registrationOnboarding";

type Props={token:string;info:z.infer<typeof publicInvitationSchema>;viewer:{id:string;name:string;email:string|null}|null};
export default function TeamInvitationAcceptance({token,info,viewer}:Props){
 const router=useRouter();const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const mismatch=viewer&&info.associatedAccountId&&viewer.id!==info.associatedAccountId;
 async function accept(){setBusy(true);setError("");try{const response=await fetch(`/api/team-invitations/${token}`,{method:"POST"});const raw:unknown=await response.json();const parsed=z.object({groupId:z.uuid()}).safeParse(raw);if(!response.ok||!parsed.success)throw new Error("Unable to accept. Check the invited account, or ask your captain for a new invitation.");router.push(`/groups/${parsed.data.groupId}`);router.refresh();}catch(e){setError(e instanceof Error?e.message:"Unable to accept");setBusy(false);}}
 async function switchAccount(){setBusy(true);try{const {error}=await createSupabaseBrowserClient().auth.signOut();if(error)throw error;router.push(`/login?next=${encodeURIComponent(`/team-invitations/${token}`)}`);router.refresh();}catch{setError("Could not sign out. Try again.");setBusy(false);}}
 return <main className="max-w-lg mx-auto p-4 py-8"><section className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4"><h1 className="font-display text-2xl font-bold text-court-green">You’re invited to {info.name}</h1>{info.description&&<p className="whitespace-pre-wrap">{info.description}</p>}<p>Invitation for {info.playerName}</p>
 {info.status==="expired"||info.status==="revoked"?<p>This invitation is no longer available. Ask your captain for a new one.</p>:info.status==="accepted"?<><p>This invitation has already been accepted.</p>{viewer?.id===info.acceptedBy&&<Link className="btn-primary block text-center" href={`/groups/${info.groupId}`}>Open team</Link>}</>:!viewer?<><p>Sign in or create an account to accept. Use Google, Apple, or email—no phone verification is required.</p><Link className="btn-primary block text-center" href={`/login?next=${encodeURIComponent(`/team-invitations/${token}`)}`}>Sign in to accept</Link></>:<><p>Signed in as <strong>{viewer.name}</strong>{viewer.email?` (${viewer.email})`:""}.</p>{mismatch?<p role="alert">This invitation is associated with {info.associatedAccountName}. Switch accounts or ask your captain to correct it.</p>:<><h2 className="font-semibold">Join {info.name} as {viewer.name}?</h2><button className="btn-primary w-full" disabled={busy} onClick={()=>void accept()}>{busy?"Joining…":"Accept invitation"}</button></>}<button className="btn-secondary w-full" disabled={busy} onClick={()=>void switchAccount()}>Switch account</button></>}
 {info.includeUsta&&<div className="rounded-xl bg-surface p-4 space-y-2"><h2 className="font-bold">USTA registration</h2><p>{info.ustaTeamName||info.name}</p><p>Team #{info.teamNumber}</p><p>Register by {formatDeadline(info.deadline)}</p>{info.includeRegistrationLink&&<a className="underline text-court-green" href={REGISTRATION_URL} target="_blank" rel="noreferrer">Register on USTA</a>}<p className="text-sm">Joining TennisFriends does not register you with USTA.</p></div>}{error&&<p role="alert" className="text-red-800">{error}</p>}</section></main>;
}
