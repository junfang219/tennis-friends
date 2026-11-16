import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { onboardingDb } from "@/lib/onboarding/db";
import { storedOnboardingSchema } from "@/lib/onboarding/contracts";
import { invitationIssues, registrationMessage } from "@/lib/registrationOnboarding";
import { deliver, deliveryConfig } from "@/lib/onboarding/delivery";

export const maxDuration=300;

export async function POST(req:Request,ctx:{params:Promise<{id:string}>}) {
 const {id}=await ctx.params;
 const db=await createSupabaseServerClient(); const {data:auth}=await db.auth.getUser();
 if(!auth.user)return NextResponse.json({error:"Sign in first"},{status:401});
 let body;try{body=z.object({batchId:z.uuid(),reminder:z.boolean().default(false),mode:z.enum(["prepare","email"]).default("prepare")}).parse(await req.json());if(!z.uuid().safeParse(id).success)throw new Error();}catch{return NextResponse.json({error:"Invalid send request"},{status:400});}
 const {data,error}=await onboardingDb(db).rpc("read_team_onboarding",{p_group:id});
 if(error)return NextResponse.json({error:"Team manager access required"},{status:403});
 const saved=storedOnboardingSchema.safeParse(data);
 if(!saved.success)return NextResponse.json({error:"Save your team first"},{status:400});
 const {config:settings,players}=saved.data;
 const selected=players.filter(p=>!body.reminder||!p.confirmed_at);
 const issues=invitationIssues({...settings,players:players.map(p=>({id:p.id,name:p.name,phone:p.phone??"",email:p.email??"",memberId:p.accepted_by,confirmedAt:p.confirmed_at,invitedAt:p.sent_at,remindedAt:null}))});
 if(issues.length||!selected.length)return NextResponse.json({error:issues.join(" ")||"No recipients"},{status:400});
 let config;try{config=deliveryConfig();}catch{return NextResponse.json({error:"Set ONBOARDING_PUBLIC_ORIGIN to the app's public URL before sending"},{status:503});}
 const admin=onboardingDb(createSupabaseAdminClient());
 const accountIds=selected.map(p=>p.associated_account_id).filter((id):id is string=>Boolean(id));
 const {data:accounts}=accountIds.length?await admin.from("profiles").select("id,email").in("id",accountIds):{data:[]};
 const emailByAccount=new Map((accounts??[]).map(a=>[a.id,a.email]));
 const recipients=selected.map(p=>({...p,email:p.email||(p.associated_account_id?emailByAccount.get(p.associated_account_id):null)||null}));
 if(body.mode==="prepare") {
  const invitations=[];
  for(const player of recipients) {
   if(Date.parse(player.expires_at)<Date.now()||player.revoked_at)continue;
   const link=`${config.origin.replace(/\/$/,"")}/team-invitations/${player.token}`;
   // sent_at means the invitation is issued/available, not proof of SMS delivery.
   const {error:issueError}=await admin.from("team_onboarding_players").update({sent_at:player.sent_at??new Date().toISOString()}).eq("id",player.id).eq("token",player.token).is("revoked_at",null).select("id").single();
   if(issueError)return NextResponse.json({error:"Could not prepare invitation; refresh and try again"},{status:409});
   invitations.push({id:player.id,name:player.name,phone:player.phone,link,message:registrationMessage({...settings,players:[]},link,body.reminder)});
  }
  return NextResponse.json({invitations});
 }
 if(!recipients.some(p=>p.email))return NextResponse.json({error:"No email addresses available. Prepare invitations and share them through Messages instead."},{status:400});
 if(recipients.some(p=>p.email)&&(!config.emailKey||!config.emailFrom))return NextResponse.json({error:"Email delivery is not configured"},{status:503});
 const {count}=await admin.from("team_onboarding_deliveries").select("id",{count:"exact",head:true}).in("player_id",players.map(p=>p.id)).gte("created_at",new Date(Date.now()-3600000).toISOString());
 if((count??0)>500)return NextResponse.json({error:"Too many invitations recently; try later"},{status:429});
 let sent=0,failed=0,pending=0;
 for(const player of recipients) {
  if(Date.parse(player.expires_at)<Date.now()||player.revoked_at){failed++;continue;}
  const link=`${config.origin.replace(/\/$/,"")}/team-invitations/${player.token}`;
  const message=registrationMessage({...settings,players:[]},link,body.reminder);
  for(const [channel,address] of [["email",player.email]] as const) {
   if(!address)continue;
   const {data:claim,error:claimError}=await admin.from("team_onboarding_deliveries").insert({player_id:player.id,batch_id:body.batchId,channel,status:"sending"}).select("id").single();
   if(claimError||!claim){
    const {data:previous}=await admin.from("team_onboarding_deliveries").select("status").eq("player_id",player.id).eq("batch_id",body.batchId).eq("channel",channel).maybeSingle();
    if(previous?.status==="sent")sent++;else if(previous?.status==="failed")failed++;else pending++;
    continue;
   }
   try {
    const providerId=await deliver(channel,address,message,`Invitation to ${settings.name}`,claim.id,config);
    const {error:recordError}=await admin.from("team_onboarding_deliveries").update({status:"sent",provider_id:providerId}).eq("id",claim.id);
    if(recordError){pending++;continue;}
    const {error:inviteError}=await admin.from("team_onboarding_players").update({sent_at:new Date().toISOString()}).eq("id",player.id);
    if(inviteError){pending++;continue;}
    sent++;
   }catch{
    await admin.from("team_onboarding_deliveries").update({status:"failed"}).eq("id",claim.id);
    failed++;
   }
  }
 }
 return NextResponse.json({sent,failed,pending,message:failed||pending?"Some deliveries failed or have an unknown outcome. Review before starting another batch.":"Invitations accepted by the delivery provider. This does not guarantee handset or inbox delivery."});
}
