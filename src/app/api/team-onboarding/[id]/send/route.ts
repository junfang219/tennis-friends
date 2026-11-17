import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { onboardingDb } from "@/lib/onboarding/db";
import { storedOnboardingSchema } from "@/lib/onboarding/contracts";
import { invitationIssues, registrationMessage } from "@/lib/registrationOnboarding";
import { invitationPhoneSchema } from "@/lib/onboarding/phone";
import { deliver, deliveryConfig, smsConfiguration, smsText, DeliveryError } from "@/lib/onboarding/delivery";

export const maxDuration=300;

export async function POST(req:Request,ctx:{params:Promise<{id:string}>}) {
 const {id}=await ctx.params;
 const db=await createSupabaseServerClient(); const {data:auth}=await db.auth.getUser();
 if(!auth.user)return NextResponse.json({error:"Sign in first"},{status:401});
 let body;try{body=z.object({batchId:z.uuid(),reminder:z.boolean().default(false),mode:z.enum(["prepare","email","sms"]).default("prepare"),smsConsent:z.boolean().optional(),playerIds:z.array(z.uuid()).min(1).max(100).optional()}).parse(await req.json());if(!z.uuid().safeParse(id).success)throw new Error();}catch{return NextResponse.json({error:"Invalid send request"},{status:400});}
 if(body.mode==="sms" && (body.reminder || body.smsConsent!==true))return NextResponse.json({error:body.reminder?"SMS reminders are not enabled; use email or share a reminder":"Confirm these players agreed to receive this invitation by SMS"},{status:400});
 if(body.reminder){const {error:syncError}=await onboardingDb(db).rpc("patch_team_onboarding",{p_group:id,p_change:{action:"init"}});if(syncError)return NextResponse.json({error:"Could not prepare the current team roster"},{status:403});}
 const {data,error}=await onboardingDb(db).rpc("read_team_onboarding",{p_group:id});
 if(error)return NextResponse.json({error:"Team manager access required"},{status:403});
 const saved=storedOnboardingSchema.safeParse(data);
 if(!saved.success)return NextResponse.json({error:"Save your team first"},{status:400});
 const {config:storedSettings,players}=saved.data;
 const settings=body.reminder||storedSettings.includeUstaInInvitations!==false?storedSettings:{...storedSettings,includeUsta:false};
 // Joining and USTA registration are independent. Existing members can still
 // receive registration reminders after their original invitation expires.
 const invitationUnavailable=(player:(typeof players)[number])=>player.revoked_at!==null||
  (Date.parse(player.expires_at)<Date.now()&&!(body.reminder&&player.accepted_by!==null));
 if(body.playerIds?.some(id=>!players.some(p=>p.id===id)))return NextResponse.json({error:"Choose invitation recipients from this team"},{status:400});
 const selected=players.filter(p=>(!body.playerIds||body.playerIds.includes(p.id))&&(!body.reminder||!p.confirmed_at));
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
   if(invitationUnavailable(player))continue;
   const link=`${config.origin.replace(/\/$/,"")}/team-invitations/${player.token}`;
   // sent_at means the invitation is issued/available, not proof of SMS delivery.
   const {error:issueError}=await admin.from("team_onboarding_players").update({sent_at:player.sent_at??new Date().toISOString()}).eq("id",player.id).eq("token",player.token).is("revoked_at",null).select("id").single();
   if(issueError)return NextResponse.json({error:"Could not prepare invitation; refresh and try again"},{status:409});
   invitations.push({id:player.id,name:player.name,phone:player.phone,link,message:registrationMessage({...settings,players:[]},link,body.reminder)});
  }
  return NextResponse.json({invitations});
 }
 if(body.mode==="sms" && (new URL(config.origin).protocol!=="https:" || ["localhost","127.0.0.1","[::1]"].includes(new URL(config.origin).hostname)))return NextResponse.json({error:"SMS invitations need a public HTTPS invitation URL. Configure ONBOARDING_PUBLIC_ORIGIN or use a preview deployment."},{status:503});
 if(body.mode==="sms" && (!smsConfiguration(config).success))return NextResponse.json({error:"SMS delivery is not configured. Contact the team administrator, or use email or the shared team link."},{status:503});
 if(body.mode==="sms" && recipients.some(p=>!invitationPhoneSchema.safeParse(p.phone).success))return NextResponse.json({error:"Each selected player needs a valid phone number"},{status:400});
 if(body.mode==="sms" && recipients.some(p=>p.accepted_by!==null))return NextResponse.json({error:"Choose players who have not already joined"},{status:400});
 if(body.mode==="email" && !recipients.some(p=>p.email))return NextResponse.json({error:"No email addresses available. Add email recipients in Invite players, or use the shared team link."},{status:400});
 if(body.mode==="email"&&recipients.some(p=>p.email)&&(!config.emailKey||!config.emailFrom))return NextResponse.json({error:"Email delivery is not configured"},{status:503});
 if(body.mode==="sms" && recipients.some(p=>smsText(registrationMessage({...settings,players:[]},`${config.origin.replace(/\/$/,"")}/team-invitations/${p.token}`,false)).length>1600))return NextResponse.json({error:"SMS is too long. Shorten the invitation message or team description, or use email."},{status:400});
 const {count,error:limitError}=await admin.from("team_onboarding_deliveries").select("id",{count:"exact",head:true}).in("player_id",players.map(p=>p.id)).gte("created_at",new Date(Date.now()-3600000).toISOString());
 if(limitError)return NextResponse.json({error:"Could not check delivery limits. Please try again."},{status:503});
 if((count??0)+recipients.length>(body.mode==="sms"?100:500))return NextResponse.json({error:"Too many invitations recently; try later"},{status:429});
 let sent=0,failed=0,pending=0;
 for(const player of recipients) {
  if(invitationUnavailable(player)){failed++;continue;}
  const link=`${config.origin.replace(/\/$/,"")}/team-invitations/${player.token}`;
  const message=registrationMessage({...settings,players:[]},link,body.reminder);
  for(const [channel,address] of body.mode==="sms" ? [["sms",invitationPhoneSchema.parse(player.phone)] as const] : [["email",player.email] as const]) {
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
    const {error:inviteError}=await admin.from("team_onboarding_players").update({sent_at:new Date().toISOString()}).eq("id",player.id).eq("token",player.token).is("revoked_at",null).select("id").single();
    if(inviteError){pending++;continue;}
    sent++;
   }catch(error){
    if(channel==="sms" && (!(error instanceof DeliveryError)||error.outcome==="unknown")){pending++;continue;}
    const {error:failureError}=await admin.from("team_onboarding_deliveries").update({status:"failed"}).eq("id",claim.id);
    if(failureError)pending++;else failed++;
   }
  }
 }
 return NextResponse.json({sent,failed,pending,message:failed||pending?"Some deliveries failed or have an unknown outcome. Review before starting another batch. Pending SMS must be reconciled with the provider before retrying.":"Invitations accepted by the delivery provider. This does not guarantee handset or inbox delivery."});
}
