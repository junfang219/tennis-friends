import { notFound } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { onboardingDb } from "@/lib/onboarding/db";
import { publicInvitationSchema } from "@/lib/onboarding/contracts";
import TeamInvitationAcceptance from "@/components/groups/TeamInvitationAcceptance";
export const dynamic="force-dynamic";
export const metadata={title:"Team invitation | TennisFriends",referrer:"no-referrer"};
export default async function TeamInvitationPage({params}:{params:Promise<{token:string}>}){
 const {token}=await params;if(!/^[a-f0-9]{64}$/.test(token))notFound();
 const db=await createSupabaseServerClient();
 const [{data},{data:auth}]=await Promise.all([onboardingDb(db).rpc("view_team_onboarding_invitation",{p_token:token}),db.auth.getUser()]);
 const parsed=publicInvitationSchema.safeParse(data);if(!parsed.success)notFound();
 const name=auth.user?z.string().safeParse(auth.user.user_metadata?.name):null;
 return <TeamInvitationAcceptance token={token} info={parsed.data} viewer={auth.user?{id:auth.user.id,email:auth.user.email??null,name:name?.success?name.data:auth.user.email??"your account"}:null}/>;
}
