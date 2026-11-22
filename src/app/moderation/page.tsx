import { notFound } from "next/navigation";
import { getContentModerator, reviewableMediaUrl } from "@/lib/moderation/server";
import { reportReasons, targetLabels } from "@/lib/moderation/contracts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import ReviewControls from "./ReviewControls";

export const metadata = { title: "Moderation | TennisFriend", robots: { index: false, follow: false } };

export default async function ModerationPage() {
  if (!await getContentModerator()) notFound();

  const { data: reports, error } = await createSupabaseAdminClient().from("content_reports")
    .select("id, target_type, reason, details, evidence_text, evidence_media, created_at")
    .is("decision", null)
    .order("created_at")
    .order("id")
    .limit(50);
  if (error) throw new Error("Couldn’t load the moderation queue.");

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-2xl font-bold text-court-green">Moderation</h1>
      {reports.length === 0 ? <p className="mt-4 text-gray-700">No reports awaiting review.</p> : (
        <ul className="mt-4 space-y-3">
          {reports.map((report) => {
            const reason = reportReasons[report.reason as keyof typeof reportReasons];
            const target = targetLabels[report.target_type as keyof typeof targetLabels];
            const media = report.evidence_media.map(reviewableMediaUrl).filter((url): url is string => url !== null);
            return (
              <li key={report.id} className="rounded-xl border border-gray-300 bg-white p-4">
                <h2 className="font-semibold text-gray-900">{reason} · {target}</h2>
                <time className="text-sm text-gray-700" dateTime={report.created_at}>
                  {new Date(report.created_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "medium", timeStyle: "short" })} PT
                </time>
                {report.details && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-gray-800">{report.details}</p>}
                {report.evidence_text && <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-surface p-3 text-sm text-gray-900">{report.evidence_text}</blockquote>}
                {media.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-3 text-sm">
                    {media.map((url, index) => (
                      <li key={url + index}>
                        <a href={url} target="_blank" rel="noopener noreferrer" className="text-court-green underline">
                          Open attachment {index + 1}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                <ReviewControls id={report.id} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
