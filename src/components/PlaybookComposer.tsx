"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createPost, updatePlaybookEntry } from "@/lib/supabase/queries";
import { toPostCamel, type PostCamel } from "@/lib/supabase/adapters";
import { uploadToBucket, isUploadError } from "@/lib/supabase/upload";
import { errorMessage } from "@/lib/errorMessage";

const MAX_MEDIA = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

type Media = {
  url: string;
  kind: "image" | "video";
  thumbnailUrl?: string;
  durationMs?: number | null;
};
type Visibility = "private" | "friends";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: (entry: PostCamel) => void;
  entry?: PostCamel | null;
}

export default function PlaybookComposer({ isOpen, onClose, onSaved, entry }: Props) {
  const editing = !!entry;
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [media, setMedia] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (isOpen) {
      setContent(entry?.content ?? "");
      setVisibility((entry?.visibility as Visibility) ?? "private");
      setMedia(
        (entry?.media ?? []).map((m) => ({
          url: m.url,
          kind: m.kind,
          thumbnailUrl: m.thumbnailUrl || undefined,
          durationMs: m.durationMs,
        })),
      );
      setErr("");
    }
  }, [isOpen, entry]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePhotos = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length === 0) return;
    const remaining = MAX_MEDIA - media.length;
    if (remaining <= 0) {
      setErr(`Up to ${MAX_MEDIA} items per entry.`);
      return;
    }
    const ok = files.filter((f) => f.size <= MAX_PHOTO_BYTES);
    const oversized = files.length - ok.length;
    const toUpload = ok.slice(0, remaining);
    if (toUpload.length === 0) {
      if (oversized > 0) setErr("Photos must be under 10 MB.");
      return;
    }
    setUploading(true);
    setErr("");
    const results = await Promise.all(
      toUpload.map((f) => uploadToBucket(f, "posts"))
    );
    const newImages: Media[] = [];
    for (const r of results) {
      if (isUploadError(r)) {
        setErr(r.message);
        continue;
      }
      if (r.mediaType === "image") newImages.push({ url: r.url, kind: "image" });
    }
    if (newImages.length > 0) setMedia((m) => [...m, ...newImages]);
    if (oversized > 0) setErr(`Skipped ${oversized} photo(s) over 10 MB.`);
    setUploading(false);
  };

  const handleVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (media.length >= MAX_MEDIA) {
      setErr(`Up to ${MAX_MEDIA} items per entry.`);
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setErr("Video must be under 100 MB.");
      return;
    }
    setUploading(true);
    setErr("");
    const r = await uploadToBucket(file, "posts");
    if (isUploadError(r)) {
      setErr(r.message);
    } else if (r.mediaType === "video") {
      setMedia((m) => [...m, { url: r.url, kind: "video" }]);
    }
    setUploading(false);
  };

  const removeMediaAt = (i: number) => setMedia((m) => m.filter((_, j) => j !== i));

  const canSubmit =
    !saving && !uploading && (content.trim().length > 0 || media.length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setErr("");
    try {
      const supabase = createSupabaseBrowserClient();
      let row;
      if (editing && entry) {
        row = await updatePlaybookEntry(supabase, entry.id, {
          content: content.trim(),
          visibility,
          media,
        });
      } else {
        row = await createPost(supabase, {
          post_type: "note",
          content: content.trim(),
          visibility,
          comments_disabled: true,
          media,
        });
      }
      onSaved(toPostCamel(row));
      onClose();
    } catch (e) {
      setErr(errorMessage(e, "Could not save entry"));
    } finally {
      setSaving(false);
    }
  };

  const VisibilityPill = ({ value, label, icon }: { value: Visibility; label: string; icon: React.ReactNode }) => (
    <button
      type="button"
      onClick={() => setVisibility(value)}
      className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${
        visibility === value
          ? "bg-court-green text-white shadow-sm"
          : "bg-transparent text-gray-500 hover:bg-gray-100"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl min-h-screen sm:min-h-0 sm:my-8 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-display text-xl font-bold text-gray-900">
            {editing ? "Edit entry" : "New playbook entry"}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-4 overflow-y-auto">
          {/* Visibility toggle */}
          <div className="flex gap-1 p-1 bg-gray-50 rounded-xl border border-gray-100">
            <VisibilityPill
              value="private"
              label="Private"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="11" width="16" height="10" rx="2" />
                  <path d="M8 11V8a4 4 0 1 1 8 0v3" />
                </svg>
              }
            />
            <VisibilityPill
              value="friends"
              label="Friends"
              icon={
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
                  <circle cx="10" cy="7" r="4" />
                  <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M17 3.13A4 4 0 0 1 17 11" />
                </svg>
              }
            />
          </div>
          <p className="text-xs text-gray-500 -mt-2 px-1">
            {visibility === "private"
              ? "Only you can see this entry."
              : "Friends can see this entry on your profile."}
          </p>

          {/* Content */}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Match notes, serve cues, reminders to yourself…"
            rows={8}
            className="w-full px-3 py-2.5 text-base border border-gray-200 rounded-xl focus:outline-none focus:border-court-green resize-none"
            autoFocus
          />

          {/* Media buttons + previews */}
          <>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21,15 16,10 5,21" />
                  </svg>
                  Photo
                  <input type="file" accept="image/*" multiple className="hidden" onChange={handlePhotos} />
                </label>
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer text-sm text-gray-700">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23,7 16,12 23,17" />
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                  Video
                  <input type="file" accept="video/*" className="hidden" onChange={handleVideo} />
                </label>
                {uploading && (
                  <span className="text-xs text-gray-500">Uploading…</span>
                )}
              </div>

              {media.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {media.map((m, i) => (
                    <div key={i} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                      {m.kind === "image" ? (
                        <img src={m.url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={`${m.url}#t=0.1`} muted preload="metadata" className="w-full h-full object-cover" />
                      )}
                      <button
                        onClick={() => removeMediaAt(i)}
                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                        aria-label="Remove"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M6 6l12 12M6 18L18 6" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg bg-court-green text-white font-medium text-sm disabled:opacity-50 hover:bg-court-green-light"
          >
            {saving ? "Saving…" : editing ? "Save" : "Post entry"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
