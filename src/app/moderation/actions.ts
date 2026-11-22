"use server";

import { revalidatePath } from "next/cache";
import { reviewDecisionSchema } from "@/lib/moderation/contracts";
import { getContentModerator } from "@/lib/moderation/server";
import { cleanupModeratedMedia } from "@/lib/moderation/media";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export type ReviewState = { error: string; message: string };

const uploadDecision = z.object({ objectId: z.uuid(), decision: z.enum(["approve", "reject"]) });

export async function decideMediaUpload(form: FormData) {
  if (!await getContentModerator()) return;
  const parsed = uploadDecision.safeParse({ objectId: form.get("objectId"), decision: form.get("decision") });
  if (!parsed.success) return;
  const { error } = await createSupabaseAdminClient().rpc("decide_media_upload", {
    p_id: parsed.data.objectId,
    p_approved: parsed.data.decision === "approve",
  });
  if (error) throw new Error("Couldn’t save the media decision.");
  revalidatePath("/moderation");
}

export async function decideContentReport(_previous: ReviewState, form: FormData): Promise<ReviewState> {
  const moderator = await getContentModerator();
  if (!moderator) return { error: "You don’t have access to review reports.", message: "" };
  const parsed = reviewDecisionSchema.safeParse({ reportId: form.get("reportId"), decision: form.get("decision") });
  if (!parsed.success) return { error: "Choose a review decision.", message: "" };

  const { reportId, decision } = parsed.data;
  const admin = createSupabaseAdminClient();
  let message = "Attachments removed.";
  if (decision !== "retry_media") {
    const { data, error } = await admin.rpc("review_content_report", {
      p_report_id: reportId,
      p_reviewer_id: moderator.id,
      p_decision: decision,
    });
    if (error) return { error: "Couldn’t save the decision. Try again.", message: "" };
    message = data ? "Decision saved." : "This report was already reviewed.";
  }
  if (decision !== "dismissed") {
    try {
      await cleanupModeratedMedia(admin, reportId);
    } catch {
      revalidatePath("/moderation");
      return { error: "Attachment removal is pending. Retry it from the moderation queue.", message: "" };
    }
  }
  revalidatePath("/moderation");
  return { error: "", message };
}
