"use server";

import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const emailPreference = z.object({ id: z.uuid(), notifyEmail: z.boolean() });

export async function setCourtAlertEmail(id: string, notifyEmail: boolean): Promise<string | null> {
  const input = emailPreference.safeParse({ id, notifyEmail });
  if (!input.success) return "Invalid court alert preference.";

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "Sign in to update this alert.";

  const { data, error } = await supabase
    .from("court_alerts")
    .update({ notify_email: input.data.notifyEmail })
    .eq("id", input.data.id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return "Couldn't save email notifications for this alert. Try again.";
  return data ? null : "This court alert is no longer available.";
}
