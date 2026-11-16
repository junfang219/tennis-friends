import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
export async function GET() {
 const db=await createSupabaseServerClient();const {data:auth}=await db.auth.getUser();
 if(!auth.user)return NextResponse.json({error:"Sign in first"},{status:401});
 const {data,error}=await onboardingDb(db).rpc("list_team_onboarding_invitations",{});
 if(error)return NextResponse.json([]);
 return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});
}
