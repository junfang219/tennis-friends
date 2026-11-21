import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}) {
 const {id}=await ctx.params;
 const db=await createSupabaseServerClient();const {data:auth}=await db.auth.getUser();
 if(!auth.user)return NextResponse.json({error:"Sign in first"},{status:401});
 let playerId:string;let renew=false;try{const body=z.object({playerId:z.uuid(),renew:z.boolean().default(false)}).parse(await req.json());playerId=body.playerId;renew=body.renew;if(!z.uuid().safeParse(id).success)throw new Error();}catch{return NextResponse.json({error:"Invalid invitation"},{status:400});}
 const {error}=await onboardingDb(db).rpc(renew?"renew_team_onboarding_invitation":"revoke_team_onboarding_invitation",{p_group:id,p_player:playerId});
 if(error?.code==="55000")return NextResponse.json({error:"This invitation has an unresolved delivery. Review it before preparing a new link."},{status:409});
 return error?NextResponse.json({error:renew?"Could not prepare a new invitation":"Could not revoke invitation"},{status:403}):NextResponse.json({ok:true});
}
