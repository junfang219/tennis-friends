import { redirect,notFound } from "next/navigation";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import TeamOnboarding from "@/components/groups/TeamOnboarding";
export default async function TeamSetupPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 if(process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED!=="true")notFound();
 const db=await createSupabaseServerClient();const {data}=await db.auth.getUser();
 if(!data.user)redirect(`/login?next=${encodeURIComponent(`/groups/${id}/onboarding`)}`);
 return <TeamOnboarding groupId={id}/>;
}
