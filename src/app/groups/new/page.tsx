import { randomUUID } from "node:crypto";
import { redirect, notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import TeamOnboarding from "@/components/groups/TeamOnboarding";
export const dynamic="force-dynamic";
export default async function NewTeamPage(){
 if(process.env.NEXT_PUBLIC_TEAM_ONBOARDING_ENABLED!=="true")notFound();
 const db=await createSupabaseServerClient();const {data}=await db.auth.getUser();
 if(!data.user)redirect("/login?next=%2Fgroups%2Fnew");
 return <TeamOnboarding groupId={randomUUID()} isNew/>;
}
