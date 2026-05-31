"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { fetchGroupBundle, getCachedGroupBundle } from "@/lib/supabase/queries";
import { uploadToBucket, isUploadError } from "@/lib/supabase/upload";

type GroupFile = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  description: string;
  createdAt: string;
  uploadedBy: { id: string; name: string; profileImageUrl: string };
  uploadedById: string;
};

type Member = { userId: string; roles: TeamRole[] };

type Group = {
  id: string;
  name: string;
  ownerId: string;
  members: Member[];
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileEmoji(mime: string): string {
  if (mime.includes("pdf")) return "📄";
  if (mime.includes("word") || mime.includes("document")) return "📝";
  if (mime.includes("sheet") || mime.includes("excel") || mime.includes("csv")) return "📊";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "📽️";
  if (mime.startsWith("text/")) return "📃";
  return "📎";
}

export default function GroupFilesPage() {
  const params = useParams();
  const { data: session } = useSession();
  const groupId = params.id as string;

  const [group, setGroup] = useState<Group | null>(null);
  const [files, setFiles] = useState<GroupFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [description, setDescription] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Note composer (text files written in-app rather than uploaded).
  const [showNote, setShowNote] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteErr, setNoteErr] = useState("");

  const loadFiles = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("group_files")
      .select(
        `id, url, filename, mime_type, size_bytes, description, created_at,
         uploadedBy:profiles!group_files_uploaded_by_id_fkey ( id, name, profile_image_url )`
      )
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });
    type Row = {
      id: string;
      url: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
      description: string;
      created_at: string;
      uploadedBy: { id: string; name: string; profile_image_url: string };
    };
    setFiles(
      ((data ?? []) as unknown as Row[]).map((f) => ({
        id: f.id,
        url: f.url,
        filename: f.filename,
        mimeType: f.mime_type,
        sizeBytes: f.size_bytes,
        description: f.description,
        createdAt: f.created_at,
        uploadedById: f.uploadedBy?.id ?? "",
        uploadedBy: {
          id: f.uploadedBy?.id ?? "",
          name: f.uploadedBy?.name ?? "Unknown",
          profileImageUrl: f.uploadedBy?.profile_image_url ?? "",
        },
      })) as unknown as GroupFile[]
    );
  }, [groupId]);

  const loadGroup = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    // Paint instantly from the cache the team page primed; revalidate below.
    const cached = getCachedGroupBundle(groupId);
    if (cached) {
      setGroup({
        id: cached.group.id,
        name: cached.group.name,
        ownerId: cached.group.owner_id,
        members: cached.members.map((m) => ({ userId: m.user_id, roles: m.roles })),
      } as unknown as typeof group);
      setLoading(false);
    }
    const { group: g, members } = await fetchGroupBundle(supabase, groupId);
    if (g) {
      setGroup({
        id: g.id,
        name: g.name,
        ownerId: g.owner_id,
        members: members.map((m) => ({ userId: m.user_id, roles: m.roles })),
      } as unknown as typeof group);
    }
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGroup();
    void loadFiles();
  }, [loadGroup, loadFiles]);

  const myId = session?.user?.id || "";
  const myRoles = group?.members.find((m) => m.userId === myId)?.roles ?? [];
  const isOwner = !!myId && group?.ownerId === myId;
  const canUpload = canCaptain({ isOwner, roles: myRoles });

  // Insert a group_files row pointing at an already-uploaded object. Shared by
  // the file-upload and write-a-note flows. Returns an error message, or null
  // on success.
  const registerFile = async (meta: {
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    description: string;
  }): Promise<string | null> => {
    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return "Not signed in.";
    const { error: insErr } = await supabase.from("group_files").insert({
      group_id: groupId,
      url: meta.url,
      filename: meta.filename,
      mime_type: meta.mimeType,
      size_bytes: meta.sizeBytes,
      description: meta.description,
      uploaded_by_id: auth.user.id,
    });
    return insErr ? insErr.message || "Failed to register file." : null;
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setUploading(true);

    const upResult = await uploadToBucket(file, "files");
    if (isUploadError(upResult)) {
      setErr(upResult.message);
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const rowErr = await registerFile({
      url: upResult.url,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      description,
    });
    if (!rowErr) {
      setDescription("");
      await loadFiles();
    } else {
      setErr(rowErr);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onSaveNote = async () => {
    const title = noteTitle.trim();
    if (!title) {
      setNoteErr("Give your note a name.");
      return;
    }
    if (!noteBody.trim()) {
      setNoteErr("Write something before saving.");
      return;
    }
    setNoteErr("");
    setSavingNote(true);

    // Save the note as a .txt file in the same bucket, so it lists, opens in
    // the viewer, and behaves like any other team file. Keep the user's
    // extension if they typed one; otherwise add .txt.
    const filename = /\.[a-z0-9]{1,8}$/i.test(title) ? title : `${title}.txt`;
    const file = new File([noteBody], filename, { type: "text/plain" });

    const upResult = await uploadToBucket(file, "files");
    if (isUploadError(upResult)) {
      setNoteErr(upResult.message);
      setSavingNote(false);
      return;
    }
    const rowErr = await registerFile({
      url: upResult.url,
      filename,
      mimeType: "text/plain",
      sizeBytes: file.size,
      description: "",
    });
    if (!rowErr) {
      setNoteTitle("");
      setNoteBody("");
      setShowNote(false);
      await loadFiles();
    } else {
      setNoteErr(rowErr);
    }
    setSavingNote(false);
  };

  const removeFile = async (fileId: string) => {
    if (!confirm("Remove this file from the team?")) return;
    const supabase = createSupabaseBrowserClient();
    const { error: delErr } = await supabase.from("group_files").delete().eq("id", fileId);
    if (!delErr) await loadFiles();
    else alert(delErr.message || "Failed to remove file.");
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton w-full h-12 rounded-xl mb-4" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton w-full h-16 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">Team not found or you&apos;re not a member.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/groups/${groupId}`}
          className="w-9 h-9 rounded-full bg-white shadow-sm border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-gray-600"
          aria-label="Back to team"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-gray-900 truncate">{group.name}</h1>
          <p className="text-xs text-gray-500">Files</p>
        </div>
      </div>

      {canUpload && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 space-y-2">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional, e.g. 'Spring league waiver')"
            maxLength={500}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv"
            onChange={onFileSelected}
            disabled={uploading}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-primary w-full"
          >
            {uploading ? "Uploading..." : "+ Upload file"}
          </button>
          <p className="text-[11px] text-gray-400">PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV up to 25 MB.</p>
          {err && <p className="text-xs text-red-600">{err}</p>}

          <div className="pt-1 border-t border-gray-100">
            {!showNote ? (
              <button
                onClick={() => {
                  setShowNote(true);
                  setNoteErr("");
                }}
                className="btn-secondary w-full mt-2"
              >
                📝 Write a note
              </button>
            ) : (
              <div className="space-y-2 mt-2">
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Note name (e.g. 'Lineup for Saturday')"
                  maxLength={200}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
                />
                <textarea
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Type your notes here…"
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green resize-y"
                />
                <div className="flex gap-2">
                  <button onClick={onSaveNote} disabled={savingNote} className="btn-primary flex-1">
                    {savingNote ? "Saving…" : "Save note"}
                  </button>
                  <button
                    onClick={() => {
                      setShowNote(false);
                      setNoteErr("");
                    }}
                    disabled={savingNote}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
                {noteErr && <p className="text-xs text-red-600">{noteErr}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {files.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-court-green-pale/30 flex items-center justify-center text-2xl">
            📎
          </div>
          <p className="text-sm font-semibold text-gray-700">No files yet</p>
          <p className="text-xs text-gray-400 mt-1">
            {canUpload ? "Upload waivers, schedules, or anything else your team needs to share." : "Ask a captain to upload one."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((f) => {
            const canRemove = f.uploadedById === myId || canUpload;
            return (
              <div key={f.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center gap-3">
                <span className="text-2xl shrink-0" aria-hidden>{fileEmoji(f.mimeType)}</span>
                {/* Open the in-app viewer (which embeds the file and keeps a
                    Back button) rather than navigating to the raw file. The
                    `files` bucket is private, so the viewer fetches it through
                    /api/groups/[id]/files/[fileId]. Navigating straight to the
                    file stranded the user with no way back. */}
                <Link
                  href={`/groups/${groupId}/files/${f.id}`}
                  className="flex-1 min-w-0 group"
                >
                  <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-court-green">{f.filename}</p>
                  <p className="text-[11px] text-gray-500">
                    {formatBytes(f.sizeBytes)} · by {f.uploadedBy.name}
                  </p>
                  {f.description && (
                    <p className="text-[11px] text-gray-600 truncate mt-0.5">{f.description}</p>
                  )}
                </Link>
                {canRemove && (
                  <button
                    onClick={() => removeFile(f.id)}
                    className="text-xs font-semibold text-red-500 hover:text-red-600 shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
