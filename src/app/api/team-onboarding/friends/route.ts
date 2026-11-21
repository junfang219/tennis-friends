import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listOnboardingFriends } from "@/lib/onboarding/friends";
export async function GET() {
 const db=await createSupabaseServerClient(); const {data}=await db.auth.getUser();
 if(!data.user) return NextResponse.json({error:"Sign in first"},{status:401});
 const friends=await listOnboardingFriends(db, data.user.id);
 return NextResponse.json(friends.map(f=>({id:f.id,name:f.name})),{headers:{"Cache-Control":"no-store"}});
}
