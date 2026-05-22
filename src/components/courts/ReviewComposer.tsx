"use client";

import { useEffect, useRef, useState } from "react";
import { StarRatingInput } from "./StarRating";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { addCourtReview } from "@/lib/supabase/queries";
import { uploadToBucket, isUploadError } from "@/lib/supabase/upload";

type Initial = {
  stars?: number;
  content?: string;
  photoUrls?: string[];
} | null;

type Props = {
  courtId: string;
  courtName: string;
  initial: Initial;
  onClose: () => void;
  onSaved: () => void;
};

const MAX_PHOTOS = 9;

export function ReviewComposer({ courtId, courtName, initial, onClose, onSaved }: Props) {
  const [stars, setStars] = useState<number>(initial?.stars ?? 0);
  const [content, setContent] = useState<string>(initial?.content ?? "");
  const [photoUrls, setPhotoUrls] = useState<string[]>(initial?.photoUrls ?? []);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - photoUrls.length;
    if (room <= 0) return;
    const list = Array.from(files).slice(0, room);
    setError("");
    setUploading(true);
    try {
      const results: string[] = [];
      for (const file of list) {
        const upResult = await uploadToBucket(file, "court-reviews");
        if (isUploadError(upResult)) throw new Error(upResult.message);
        results.push(upResult.url);
      }
      setPhotoUrls((prev) => [...prev, ...results].slice(0, MAX_PHOTOS));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePhoto = (i: number) => {
    setPhotoUrls((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async () => {
    if (stars < 1) {
      setError("Please choose a star rating");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await addCourtReview(supabase, courtId, { stars, content, photoUrls });
      onSaved();
    } catch (e) {
      // Supabase throws a PostgrestError, not an Error instance — checking
      // instanceof first hides the real message. Probe the common shapes.
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null && "message" in e
            ? String((e as { message: unknown }).message)
            : "Failed to save review";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const isEdit = !!initial;

  return (
    // z-[10000] is the project convention for full-screen modals — keeps us
    // above the BottomNav (zIndex 9999). On mobile, the card's max-height
    // subtracts the BottomNav height (h-16 ≈ 4rem) plus the iPhone's safe
    // area, and margin-bottom pushes it above the nav so the footer with
    // the submit button is never hidden behind the tab bar.
    <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col
                   max-h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] sm:max-h-[92vh]
                   mb-[calc(4rem+env(safe-area-inset-bottom))] sm:mb-0"
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display font-bold text-court-green text-lg leading-tight">
              {isEdit ? "Edit your review" : "Write a review"}
            </h2>
            <p className="text-xs text-gray-500 truncate mt-0.5">{courtName}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 -mr-2 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <div className="flex flex-col items-center py-2">
            <StarRatingInput value={stars} onChange={setStars} />
            <p className="text-xs text-gray-500 mt-2">
              {stars === 0 ? "Tap to rate" : ratingLabel(stars)}
            </p>
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share details of your experience at this court…"
            rows={4}
            maxLength={4000}
            className="mt-4 w-full p-3 rounded-xl border border-gray-200 focus:outline-none focus:border-court-green focus:ring-2 focus:ring-court-green/20 text-sm resize-none"
          />

          {/* Photos */}
          <div className="mt-4">
            <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">
              Photos ({photoUrls.length}/{MAX_PHOTOS})
            </p>
            <div className="grid grid-cols-3 gap-2">
              {photoUrls.map((url, i) => (
                <div key={url + i} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                    aria-label="Remove photo"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
              {photoUrls.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="aspect-square rounded-lg border-2 border-dashed border-gray-200 hover:border-court-green hover:bg-court-green/5 transition-colors flex items-center justify-center text-gray-400 hover:text-court-green disabled:opacity-50"
                  aria-label="Add photo"
                >
                  {uploading ? (
                    <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  )}
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>

          {error && (
            <div className="mt-3 p-2.5 rounded-lg bg-red-50 text-red-700 text-xs border border-red-100">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || uploading || stars < 1}
            className="btn-primary px-5 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Saving…" : isEdit ? "Save changes" : "Post review"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ratingLabel(s: number) {
  return ["", "Terrible", "Poor", "Average", "Good", "Excellent"][s] || "";
}
