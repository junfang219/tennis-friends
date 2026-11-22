import { after, NextResponse } from "next/server";
import { Resend } from "resend";
import { z } from "zod";
import { contentReportSchema } from "@/lib/moderation/contracts";
import { readReportEvidence, reviewableMediaUrl } from "@/lib/moderation/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { blockUser } from "@/lib/supabase/queries/friends";

function failure(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

const noticeConfig = z.object({ apiKey: z.string().min(1), recipient: z.email() });

async function notifyModerators() {
  const config = noticeConfig.safeParse({ apiKey: process.env.RESEND_API_KEY, recipient: process.env.REPORT_EMAIL });
  if (!config.success) return;
  const { apiKey, recipient } = config.data;
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: "TennisFriend <reports@mytennisfriends.com>",
      to: recipient,
      subject: "TennisFriend content report",
      text: "A new report is waiting in the moderation queue. https://mytennisfriends.com/moderation",
    });
    if (error) console.warn("Content report notification failed");
  } catch {
    console.warn("Content report notification failed");
  }
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return failure("Use a JSON request.", 415);
  }
  const input = contentReportSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return failure("Choose a reason and check your report details.", 400);
  const db = await createSupabaseServerClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return failure("Sign in to report content.", 401);

  const { targetType, targetId, reason, details, blockAuthor } = input.data;
  try {
    const evidence = await readReportEvidence(db, targetType, targetId);
    if (!evidence) return failure("This content is no longer available to report.", 404);
    if (evidence.authorId === user.id) return failure("You can only report someone else’s content.", 400);

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("record_content_report", {
      p_reporter_id: user.id,
      p_author_id: evidence.authorId,
      p_target_type: targetType,
      p_target_id: targetId,
      p_reason: reason,
      p_details: details,
      p_evidence_text: evidence.content,
      p_evidence_media: evidence.media.map(reviewableMediaUrl).filter((url): url is string => url !== null),
    });
    if (error) throw error;
    if (data === "rate_limited") return failure("You’ve reached the daily reporting limit. Try again later.", 429);
    if (data !== "created" && data !== "duplicate") throw new Error("Unknown report outcome");
    if (data === "created") after(notifyModerators);

    let blockFailed = false;
    if (blockAuthor) {
      try {
        await blockUser(db, evidence.authorId);
      } catch {
        blockFailed = true;
      }
    }
    return NextResponse.json({
      ok: true,
      duplicate: data === "duplicate",
      blockFailed,
      blockedAuthorId: blockAuthor && !blockFailed ? evidence.authorId : null,
    });
  } catch {
    return failure("Couldn’t send the report. Try again.", 500);
  }
}
