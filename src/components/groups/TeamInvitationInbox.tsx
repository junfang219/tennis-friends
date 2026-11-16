"use client";
import { useEffect,useState } from "react";
import Link from "next/link";
import { z } from "zod";
const Invitations=z.array(z.object({token:z.string(),name:z.string(),playerName:z.string()}));
export default function TeamInvitationInbox(){
 const [items,setItems]=useState<z.infer<typeof Invitations>>([]);
 useEffect(()=>{let active=true;void fetch("/api/team-invitations").then(r=>r.json()).then(raw=>{const parsed=Invitations.safeParse(raw);if(active&&parsed.success)setItems(parsed.data);}).catch(()=>{});return()=>{active=false;};},[]);
 if(!items.length)return null;
 return <section className="bg-white border border-court-green rounded-2xl p-4 mb-5"><h2 className="font-bold text-court-green mb-2">Team invitations</h2><ul className="space-y-3">{items.map(i=><li key={i.token}><Link className="text-court-green underline" href={`/team-invitations/${i.token}`}>Join {i.name} as {i.playerName}</Link></li>)}</ul></section>;
}
