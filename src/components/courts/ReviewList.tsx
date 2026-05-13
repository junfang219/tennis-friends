"use client";

import { useState } from "react";
import { StarRating } from "./StarRating";

export type Review = {
  id: string;
  stars: number;
  content: string;
  photoUrls: string[];
  createdAt: string;
  user: { id: string; name: string; profileImageUrl: string };
  isMine: boolean;
};

type Props = {
  reviews: Review[];
  onEdit?: (review: Review) => void;
  onDelete?: (review: Review) => void;
};

export function ReviewList({ reviews, onEdit, onDelete }: Props) {
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null);

  if (reviews.length === 0) {
    return (
      <div className="py-10 text-center text-gray-400 text-sm">
        No reviews yet. Be the first to share your experience.
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-gray-100">
        {reviews.map((r) => (
          <li key={r.id} className="py-4">
            <div className="flex items-start gap-3">
              <Avatar name={r.user.name} src={r.user.profileImageUrl} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {r.user.name}
                      {r.isMine && (
                        <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wide text-court-green bg-court-green/10 px-1.5 py-0.5 rounded">
                          You
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StarRating value={r.stars} size={13} />
                      <span className="text-[11px] text-gray-500">
                        {relativeTime(r.createdAt)}
                      </span>
                    </div>
                  </div>
                  {r.isMine && (onEdit || onDelete) && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {onEdit && (
                        <button
                          onClick={() => onEdit(r)}
                          className="text-xs text-court-green font-medium hover:underline px-2 py-1"
                        >
                          Edit
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => {
                            if (confirm("Delete your review?")) onDelete(r);
                          }}
                          className="text-xs text-red-600 font-medium hover:underline px-2 py-1"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {r.content && (
                  <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {r.content}
                  </p>
                )}
                {r.photoUrls.length > 0 && (
                  <div className="mt-3 flex gap-1.5 flex-wrap">
                    {r.photoUrls.map((url, idx) => (
                      <button
                        key={url}
                        onClick={() => setLightbox({ photos: r.photoUrls, index: idx })}
                        className="w-20 h-20 rounded-lg overflow-hidden bg-gray-100 hover:opacity-90"
                        aria-label={`Open photo ${idx + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {lightbox && (
        <SimpleLightbox
          photos={lightbox.photos}
          startIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

function Avatar({ name, src }: { name: string; src: string }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className="w-9 h-9 rounded-full object-cover bg-gray-100 flex-shrink-0"
      />
    );
  }
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-court-green/10 text-court-green font-semibold flex items-center justify-center text-sm flex-shrink-0">
      {initial}
    </div>
  );
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const seconds = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return "just now";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

function SimpleLightbox({
  photos,
  startIndex,
  onClose,
}: {
  photos: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(startIndex);
  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
        aria-label="Close"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      {i > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); setI(i - 1); }}
          className="absolute left-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {i < photos.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); setI(i + 1); }}
          className="absolute right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photos[i]}
        alt=""
        className="max-h-[90vh] max-w-[92vw] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
