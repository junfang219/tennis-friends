"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// In-app file viewer.
//
// The `files` bucket is private, so files are served through our
// /api/groups/[id]/files/[fileId] route (302 → short-lived signed URL).
// Rendering that inside an <iframe> on THIS page — rather than navigating the
// WebView to the raw file — keeps the app shell present, so the header's Back
// button always returns to the team's Files list. Navigating in-place (or, in
// the Capacitor WebView, opening target=_blank) left the user stranded on the
// raw file with no way back.

export default function GroupFileViewerPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.id as string;
  const fileId = params.fileId as string;

  const [meta, setMeta] = useState<{ filename: string; mimeType: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      // RLS (group_files_select_member) returns the row only to team members.
      const { data } = await supabase
        .from("group_files")
        .select("filename, mime_type")
        .eq("id", fileId)
        .eq("group_id", groupId)
        .maybeSingle();
      if (!active) return;
      if (data) setMeta({ filename: data.filename, mimeType: data.mime_type });
      else setMissing(true);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [fileId, groupId]);

  const fileUrl = `/api/groups/${groupId}/files/${fileId}`;
  const goBack = () => router.push(`/groups/${groupId}/files`);

  // Browsers can render these inline; everything else (docx, xlsx, zip…) is
  // offered as a download instead of a blank frame.
  const canPreview =
    !!meta &&
    (meta.mimeType === "application/pdf" ||
      meta.mimeType.startsWith("image/") ||
      meta.mimeType.startsWith("text/"));

  return (
    <div className="fixed inset-0 z-[10000] bg-white flex flex-col">
      <header className="flex items-center gap-2 px-2 border-b border-gray-200 bg-white pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
        <button
          onClick={goBack}
          aria-label="Back to files"
          className="w-9 h-9 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-700 shrink-0"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <p className="font-semibold text-gray-900 truncate flex-1">{meta?.filename ?? "File"}</p>
      </header>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="p-4">
            <div className="skeleton w-full h-full min-h-[60vh] rounded-xl" />
          </div>
        ) : missing ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
            <p className="text-sm text-gray-500">This file isn&apos;t available, or you&apos;re not a member of this team.</p>
            <button onClick={goBack} className="btn-secondary">Back to files</button>
          </div>
        ) : canPreview ? (
          <iframe src={fileUrl} title={meta?.filename ?? "File"} className="w-full h-full border-0" />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
            <div className="w-14 h-14 rounded-full bg-court-green-pale/30 flex items-center justify-center text-2xl">📎</div>
            <p className="text-sm font-semibold text-gray-700">{meta?.filename}</p>
            <p className="text-xs text-gray-400">This file type can&apos;t be previewed here.</p>
            {/* target=_blank: in the Capacitor WebView this opens/downloads via
                the system browser. The viewer page stays mounted, so Back still
                works when the user returns. */}
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
              Open file
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
