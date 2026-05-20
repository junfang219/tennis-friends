"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { isAtLeast, ROLE } from "@/lib/groupRoles";

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

type Member = { userId: string; role: string };

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

  const loadFiles = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}/files`);
    if (res.ok) setFiles(await res.json());
  }, [groupId]);

  const loadGroup = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}`);
    if (res.ok) setGroup(await res.json());
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGroup();
    void loadFiles();
  }, [loadGroup, loadFiles]);

  const myId = session?.user?.id || "";
  const myRole = group && myId
    ? group.members.find((m) => m.userId === myId)?.role ?? null
    : null;
  const canUpload = !!myRole && isAtLeast(myRole, ROLE.CAPTAIN);

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setUploading(true);

    const fd = new FormData();
    fd.append("file", file);
    const upRes = await fetch("/api/upload/file", { method: "POST", body: fd });
    if (!upRes.ok) {
      const d = await upRes.json().catch(() => ({}));
      setErr(d.error || "Upload failed.");
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const upData = await upRes.json();

    const regRes = await fetch(`/api/groups/${groupId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: upData.url,
        filename: upData.filename,
        mimeType: upData.mimeType,
        sizeBytes: upData.sizeBytes,
        description,
      }),
    });
    if (regRes.ok) {
      setDescription("");
      await loadFiles();
    } else {
      const d = await regRes.json().catch(() => ({}));
      setErr(d.error || "Failed to register file.");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = async (fileId: string) => {
    if (!confirm("Remove this file from the team?")) return;
    const res = await fetch(`/api/groups/${groupId}/files/${fileId}`, { method: "DELETE" });
    if (res.ok) await loadFiles();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to remove file.");
    }
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
            const canRemove = f.uploadedById === myId || (myRole && isAtLeast(myRole, ROLE.CAPTAIN));
            return (
              <div key={f.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex items-center gap-3">
                <span className="text-2xl shrink-0" aria-hidden>{fileEmoji(f.mimeType)}</span>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-0 group"
                  download={f.filename}
                >
                  <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-court-green">{f.filename}</p>
                  <p className="text-[11px] text-gray-500">
                    {formatBytes(f.sizeBytes)} · by {f.uploadedBy.name}
                  </p>
                  {f.description && (
                    <p className="text-[11px] text-gray-600 truncate mt-0.5">{f.description}</p>
                  )}
                </a>
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
