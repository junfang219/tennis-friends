import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
import { publicInvitationSchema } from "@/lib/onboarding/contracts";
const Token=z.string().regex(/^[a-f0-9]{64}$/);
export async function GET(_req:Request,ctx:{params:Promise<{token:string}>}) {
 const {token}=await ctx.params;
 if(!Token.safeParse(token).success)return NextResponse.json({error:"Invalid invitation"},{status:404});
 const db=onboardingDb(await createSupabaseServerClient());
 const {data,error}=await db.rpc("view_team_onboarding_invitation",{p_token:token});
 const parsed=publicInvitationSchema.safeParse(data);
 return error||!parsed.success?NextResponse.json({error:"Invitation unavailable"},{status:404}):NextResponse.json(parsed.data,{headers:{"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}
export async function POST(_req:Request,ctx:{params:Promise<{token:string}>}) {
 const {token}=await ctx.params;const db=await createSupabaseServerClient();
 const {data:auth}=await db.auth.getUser();
 if(!auth.user)return NextResponse.json({error:"Sign in to accept"},{status:401});
 if(!Token.safeParse(token).success)return NextResponse.json({error:"Invalid invitation"},{status:400});
 const {data,error}=await onboardingDb(db).rpc("accept_team_onboarding_invitation",{p_token:token});
 const result=z.object({groupId:z.uuid()}).safeParse(data);
 return error||!result.success?NextResponse.json({error:"Cannot accept this invitation. It may have expired, been revoked, or belong to a different account."},{status:400}):NextResponse.json(result.data);
}
