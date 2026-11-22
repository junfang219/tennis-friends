"use server";

import { revalidatePath } from "next/cache";
import { reviewDecisionSchema } from "@/lib/moderation/contracts";
import { getContentModerator } from "@/lib/moderation/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type ReviewState = { error: string; message: string };

export async function decideContentReport(_previous: ReviewState, form: FormData): Promise<ReviewState> {
  const moderator = await getContentModerator();
  if (!moderator) return { error: "You don’t have access to review reports.", message: "" };
  const parsed = reviewDecisionSchema.safeParse({ reportId: form.get("reportId"), decision: form.get("decision") });
  if (!parsed.success) return { error: "Choose a review decision.", message: "" };

  const { data, error } = await createSupabaseAdminClient().rpc("review_content_report", {
    p_report_id: parsed.data.reportId,
    p_reviewer_id: moderator.id,
    p_decision: parsed.data.decision,
  });
  if (error) return { error: "Couldn’t save the decision. Try again.", message: "" };
  revalidatePath("/moderation");
  return { error: "", message: data ? "Decision saved." : "This report was already reviewed." };
}
