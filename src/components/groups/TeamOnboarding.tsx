"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import Link from "next/link";
import { z } from "zod";
import RegistrationPlayers from "./RegistrationPlayers";
import { blankRegistrationDraft, registrationMessage, formatDeadline, type RegistrationDraft } from "@/lib/registrationOnboarding";
import { storedOnboardingSchema, type storedPlayerSchema } from "@/lib/onboarding/contracts";

type SavedPlayer=z.infer<typeof storedPlayerSchema>;
const input="mt-1 w-full px-3 py-3 border border-gray-300 rounded-xl text-base";
const PreparedInvitations=z.array(z.object({id:z.uuid(),name:z.string(),phone:z.string().nullable(),link:z.url(),message:z.string()}));
const Friends=z.array(z.object({id:z.uuid(),name:z.string()}));
export default function TeamOnboarding({groupId,isNew=false}:{groupId:string;isNew?:boolean}){
 const [draft,setDraft]=useState<RegistrationDraft>(blankRegistrationDraft);
 const [savedPlayers,setSavedPlayers]=useState<SavedPlayer[]>([]);
 const [friends,setFriends]=useState<z.infer<typeof Friends>>([]);
 const [step,setStep]=useState(isNew?0:3);
 const [loading,setLoading]=useState(!isNew);const [busy,setBusy]=useState(false);
 const [friendsLoading,setFriendsLoading]=useState(true);
 const [friendsError,setFriendsError]=useState("");
 const [returnToOverview,setReturnToOverview]=useState(false);
 const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const [saved,setSaved]=useState(!isNew);
 const [reminders,setReminders]=useState(false);
 const [prepared,setPrepared]=useState<z.infer<typeof PreparedInvitations>>([]);
 const batch=useRef<string|null>(null);
 const dateRef=useRef<HTMLInputElement>(null);
 const headingRef=useRef<HTMLHeadingElement>(null);
 async function responseJson(response:Response):Promise<unknown>{const raw:unknown=await response.json();if(!response.ok){const parsed=z.object({error:z.string()}).safeParse(raw);throw new Error(parsed.success?parsed.data.error:"Request failed");}return raw;}
 const applySaved=useCallback((raw:unknown)=>{
  const data=storedOnboardingSchema.parse(raw);setSavedPlayers(data.players);
  setDraft({...data.config,players:data.players.map(p=>({id:p.id,name:p.name,phone:p.phone??"",email:p.email??"",memberId:p.accepted_by,associatedAccountId:p.associated_account_id,associatedAccountName:p.associated_account_name,joinedAt:p.accepted_at,confirmedAt:p.confirmed_at,invitedAt:p.sent_at,remindedAt:null}))});
 },[]);
 async function reload(){applySaved(await responseJson(await fetch(`/api/team-onboarding/${groupId}`,{cache:"no-store"})));}
 useEffect(()=>{
  let active=true;
  try { batch.current=sessionStorage.getItem(`team-onboarding-batch:${groupId}`); } catch { /* Session storage is optional; server still deduplicates a batch. */ }
  // Friend suggestions are optional and must not delay the new-team form or
  // prevent an existing team's setup from loading.
  async function loadFriends(){try{
   const data=Friends.parse(await responseJson(await fetch("/api/team-onboarding/friends",{cache:"no-store"})));
   if(active)setFriends(data);
  }catch{if(active)setFriendsError("Your friends could not be loaded. You can still add players by phone or email.");}
  finally{if(active)setFriendsLoading(false);}}
  async function loadTeam(){try{
   const data=await responseJson(await fetch(`/api/team-onboarding/${groupId}`,{cache:"no-store"}));
   if(active)applySaved(data);
  }catch(e){if(active)setError(e instanceof Error?e.message:"Could not load team");}
  finally{if(active)setLoading(false);}}
  void loadFriends();if(!isNew)void loadTeam();
  return()=>{active=false;};
 },[groupId,isNew,applySaved]);
 useEffect(()=>{headingRef.current?.focus();},[step]);
 const patch=(p:Partial<RegistrationDraft>)=>{setDraft(d=>({...d,...p}));setPrepared([]);batch.current=null;};
 const value=()=>step===2&&draft.includeUsta?{...draft,deadline:dateRef.current?.value??draft.deadline}:draft;
 async function save(current=value()){
  const {players,...config}=current;
  await responseJson(await fetch(`/api/team-onboarding/${groupId}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({draft:config,players:players.map(p=>({id:p.id,name:p.name,phone:p.phone,email:p.email,associatedAccountId:p.associatedAccountId??null,confirmedAt:p.confirmedAt}))})}));
  setSaved(true);setDraft(current);window.history.replaceState(null,"",`/groups/${groupId}/onboarding`);
 }
 async function action(work:()=>Promise<void>){if(busy)return;setBusy(true);setError("");setNotice("");try{await work();}catch(e){setError(e instanceof Error?e.message:"Could not complete action");}finally{setBusy(false);}}
 async function viewOverview(){await save();await reload();setReturnToOverview(false);setStep(3);}
 function editStep(nextStep:number){setReturnToOverview(true);setError("");setNotice("");setStep(nextStep);}
 async function shareInvitation(invitation:z.infer<typeof PreparedInvitations>[number]) {
  if(typeof navigator.share==="function") {
   try{await navigator.share({title:`Join ${draft.name}`,text:invitation.message});setNotice("Share sheet opened. Complete sending in your messaging app; delivery is not tracked.");return;}
   catch(e){if(e instanceof Error&&e.name==="AbortError")return;}
  }
  await navigator.clipboard.writeText(invitation.message);
  setNotice("Invitation copied. Open Messages, choose the player, and paste to send. Delivery is not tracked.");
 }
 async function send(reminder=false,mode:"prepare"|"email"="prepare"){
  await save();
  const batchId=batch.current??crypto.randomUUID();batch.current=batchId;
  try { sessionStorage.setItem(`team-onboarding-batch:${groupId}`,batchId); } catch { /* Server batch claims still protect this request. */ }
  const raw=await responseJson(await fetch(`/api/team-onboarding/${groupId}/send`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({batchId,reminder,mode})}));
  if(mode==="prepare") {
   setPrepared(z.object({invitations:PreparedInvitations}).parse(raw).invitations);
   setNotice("Personal invitations are ready. Share each message from your own messaging app. No texts or emails have been sent automatically.");
   await reload();setStep(3);setReturnToOverview(false);setReminders(false);return;
  }
  const report=z.object({sent:z.number(),failed:z.number(),pending:z.number(),message:z.string()}).parse(raw);
  setNotice(`${report.sent} emails accepted; ${report.failed} failed; ${report.pending} pending. ${report.message}`);
  if(!report.failed&&!report.pending){batch.current=null;try{sessionStorage.removeItem(`team-onboarding-batch:${groupId}`);}catch{ /* No contact details are stored here. */ }}
  await reload();setStep(3);setReturnToOverview(false);setReminders(false);
 }
 if(loading)return <p className="p-5">Loading team setup…</p>;
 return <main className="max-w-2xl mx-auto p-4 py-8 space-y-5"><h1 ref={headingRef} tabIndex={-1} className="font-display text-3xl font-bold text-court-green">{["Create your team","Add your players","Invite your players",draft.name||"Team overview"][step]}</h1><ol aria-label="Team setup" className="grid grid-cols-4 gap-2 text-xs">{["Team details","Players","Invitations","Overview"].map((s,i)=><li key={s} aria-current={step===i?"step":undefined} className={`border-t-4 pt-2 ${step===i?"border-court-green font-bold":"border-gray-300"}`}>{i+1}. {s}</li>)}</ol>
 {error&&<p role="alert" className="bg-red-50 text-red-800 p-3 rounded-xl">{error}</p>}{notice&&<p role="status" className="bg-green-50 text-green-950 p-3 rounded-xl text-sm">{notice}</p>}
 {prepared.length>0&&<section aria-label="Personal invitations to share" className="bg-white rounded-2xl border p-5 space-y-4"><h2 className="font-bold text-xl">Share personal invitations</h2><p className="text-sm">Send each personal message to the named player. Opening the share sheet or copying a message does not confirm delivery.</p>{prepared.map(inv=><div key={inv.id} className="border-t pt-4 space-y-2"><strong>{inv.name}</strong>{inv.phone&&<p className="text-sm">{inv.phone}</p>}<textarea aria-label={`Invitation for ${inv.name}`} readOnly value={inv.message} rows={5} className={input}/><button disabled={busy} className="btn-primary" onClick={()=>void action(()=>shareInvitation(inv))}>Share invitation</button><button disabled={busy} className="btn-secondary ml-2" onClick={()=>void action(async()=>{await navigator.clipboard.writeText(inv.message);setNotice("Message copied. Paste it into Messages to send; delivery is not tracked.");})}>Copy message</button></div>)}</section>}
 {step===0&&isNew&&!saved&&<section aria-labelledby="usta-import-heading" className="rounded-2xl border border-court-green/25 bg-court-green/5 p-5 space-y-3"><h2 id="usta-import-heading" className="font-semibold text-court-green">Already have a USTA team?</h2><p className="text-sm text-gray-700">Use the USTA setup to find your existing team and import its schedule and roster.</p><Link href="/groups?setup=existing" className="btn-secondary inline-flex items-center justify-center gap-2 w-full sm:w-auto">Import a USTA team<svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></Link></section>}
 <fieldset disabled={busy} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5 disabled:opacity-70">
 {step===0&&<><label className="block font-semibold text-sm">Team name<input className={input} value={draft.name} onChange={e=>patch({name:e.target.value})}/></label><label className="block font-semibold text-sm">Description (optional)<textarea className={input} rows={4} value={draft.description??""} onChange={e=>patch({description:e.target.value})}/></label></>}
 {step===1&&<RegistrationPlayers review={false} friendAccounts={friends} friendsLoading={friendsLoading} friendsError={friendsError} players={draft.players} onChange={players=>patch({players})}/>}
 {step===2&&<><h2 className="font-bold text-xl">Invite your players</h2><p className="text-sm text-gray-600">Personal join links are always included. USTA registration is optional.</p><label className="flex gap-3 text-sm"><input type="checkbox" checked={draft.includeDescription!==false} onChange={e=>patch({includeDescription:e.target.checked})}/>Include team description</label><label className="flex gap-3 text-sm"><input type="checkbox" checked={Boolean(draft.includeUsta)} onChange={e=>patch({includeUsta:e.target.checked})}/>Include USTA registration instructions</label>
 {draft.includeUsta&&<div className="bg-surface rounded-xl p-4 space-y-3"><label className="block text-sm font-semibold">USTA team name<input className={input} value={draft.ustaTeamName??draft.name} onChange={e=>patch({ustaTeamName:e.target.value})}/></label><label className="block text-sm font-semibold">USTA team number<input className={input} inputMode="numeric" maxLength={10} value={draft.teamNumber} onChange={e=>patch({teamNumber:e.target.value})}/></label><label className="block text-sm font-semibold">Registration deadline<input className={input} type="date" ref={dateRef} defaultValue={draft.deadline} onChange={e=>patch({deadline:e.target.value})}/></label><label className="flex gap-3 text-sm"><input type="checkbox" checked={draft.includeRegistrationLink!==false} onChange={e=>patch({includeRegistrationLink:e.target.checked})}/>Include USTA registration link</label></div>}
 <label className="block text-sm font-semibold">Invitation message<textarea className={input} rows={5} value={draft.invitationMessage??`You're invited to join ${draft.name} on TennisFriends!`} onChange={e=>patch({invitationMessage:e.target.value})}/></label><h3 className="font-semibold text-sm">Full message preview</h3><pre className="whitespace-pre-wrap break-words bg-surface rounded-xl p-4 text-sm font-sans">{registrationMessage(draft,"[personal invitation link]")}</pre><p className="text-xs text-gray-600">Prepare a personal link for each player, then share it through your own Messages app. You choose the recipient and tap Send. Text delivery cannot be tracked. Email invitations can be sent separately.</p><button className="btn-primary w-full" onClick={()=>void action(()=>send())}>Prepare invitations to share</button><button className="btn-secondary w-full" onClick={()=>void action(()=>send(false,"email"))}>Send email invitations</button></>}
 {step===3&&<><p className="whitespace-pre-wrap">{draft.description}</p><p className="font-semibold">TennisFriends: {draft.players.filter(p=>p.memberId).length} / {draft.players.length} joined</p>{draft.includeUsta&&<p className="font-semibold">USTA: {draft.players.filter(p=>p.confirmedAt).length} / {draft.players.length} confirmed · {formatDeadline(draft.deadline)}</p>}
 <ul className="divide-y divide-gray-200">{draft.players.map(p=><li key={p.id} className="py-4 space-y-2"><strong>{p.name}</strong><p className="text-sm break-all">{[p.phone,p.email].filter(Boolean).join(" · ")}</p><p className="text-sm">{p.memberId?"Joined team":p.associatedAccountId?"Associated account · Acceptance pending":"No account linked"}</p><p className="text-xs text-gray-600">{p.invitedAt?"Invitation link ready · Text delivery not tracked":"Invitation not prepared"}</p>{draft.includeUsta&&<><p className="text-sm">USTA: {p.confirmedAt?"Confirmed by captain":"Unconfirmed"}</p><button className="btn-secondary text-sm" onClick={()=>void action(async()=>{await save({...draft,players:draft.players.map(other=>other.id===p.id?{...other,confirmedAt:other.confirmedAt?null:new Date().toISOString()}:other)});await reload();})}>{p.confirmedAt?"Undo registration confirmation":"Confirm from TennisLink"}</button></>}{savedPlayers.find(s=>s.id===p.id)?.revoked_at&&<p className="text-sm text-red-800">Invitation revoked</p>}{!p.memberId&&<button className="btn-secondary text-sm" onClick={()=>void action(async()=>{await responseJson(await fetch(`/api/team-onboarding/${groupId}/revoke`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:p.id,renew:true})}));batch.current=null;await reload();setNotice("New invitation link prepared. Prepare invitations to share the new link; the old link no longer works.");})}>Prepare new invitation link</button>}{savedPlayers.find(s=>s.id===p.id)?.sent_at&&!p.memberId&&<button className="text-sm underline text-red-800 block" onClick={()=>void action(async()=>{await responseJson(await fetch(`/api/team-onboarding/${groupId}/revoke`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({playerId:p.id})}));await reload();})}>Revoke invitation</button>}</li>)}</ul>
 <button className="btn-secondary w-full" onClick={()=>{batch.current=null;editStep(2);}}>Edit invitations</button><button className="btn-secondary w-full" onClick={()=>editStep(0)}>Edit team details</button><button className="btn-secondary w-full" onClick={()=>editStep(1)}>Edit players</button>{!draft.includeUsta&&<button className="btn-secondary w-full" onClick={()=>{patch({includeUsta:true});editStep(2);}}>Add USTA registration task</button>}{draft.includeUsta&&<><button className="btn-secondary w-full" onClick={()=>{batch.current=null;setReminders(true);}}>Review USTA reminders</button>{reminders&&<div className="rounded-xl border border-gray-300 p-4 space-y-3"><p className="text-sm">Only unconfirmed players: {draft.players.filter(p=>!p.confirmedAt).map(p=>p.name).join(", ")||"None"}. Check TennisLink first; imports are not automatic.</p><button className="btn-primary w-full" onClick={()=>void action(()=>send(true))}>Prepare reminders to share</button><button className="btn-secondary w-full" onClick={()=>void action(()=>send(true,"email"))}>Send email reminders</button><button className="btn-secondary w-full" onClick={()=>setReminders(false)}>Cancel</button></div>}</>}<Link className="btn-primary block text-center" href={`/groups/${groupId}`}>Open team</Link></>}
 {step<2&&<button className="btn-primary w-full" onClick={()=>void action(async()=>{if(step===1&&!draft.players.length)throw new Error("Add at least one player");if(returnToOverview){await viewOverview();return;}await save();setStep(s=>s+1);})}>{busy?"Saving…":returnToOverview?"Save and return to overview":"Continue"}</button>}
 {step===2&&<button className="btn-secondary w-full" onClick={()=>void action(viewOverview)}>{busy?"Saving…":returnToOverview?"Save and return to overview":"Save and view team overview"}</button>}
 {step<3&&<div className="flex flex-wrap gap-4 justify-between">{step>0&&!returnToOverview&&<button className="text-sm underline text-court-green" onClick={()=>void action(async()=>{await save();setStep(s=>s-1);})}>Back</button>}<button className="text-sm underline text-court-green" onClick={()=>void action(async()=>{await save();setNotice("Team draft saved. You can keep editing here.");})}>Save draft</button></div>}
 </fieldset></main>;
}
