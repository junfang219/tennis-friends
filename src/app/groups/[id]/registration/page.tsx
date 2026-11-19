import Link from "next/link";
import { teamPage } from "@/lib/onboarding/team-page";
import TeamRegistration from "@/components/groups/TeamRegistration";
export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { group } = await teamPage(id, "registration");
  return <main className="max-w-2xl mx-auto p-4 py-6 space-y-5"><Link href={`/groups/${id}/roster`} className="text-sm underline text-court-green">Back to roster</Link><p className="text-sm text-gray-600">{group.name}</p><h1 className="font-display text-3xl font-bold text-court-green">USTA registration</h1><TeamRegistration groupId={id} /></main>;
}
