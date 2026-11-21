import GroupSettings from "@/components/groups/GroupSettings";
import { z } from "zod";

export default async function GroupSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const tab = z.literal("roster").safeParse((await searchParams).tab);
  return <GroupSettings initialTab={tab.success ? tab.data : "team"} />;
}
