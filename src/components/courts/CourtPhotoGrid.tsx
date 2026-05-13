"use client";

import { useEffect, useState } from "react";

type Props = {
  photos: string[];
  className?: string;
};

// Google-Maps-style hero collage: 1 large left + up to 2 stacked right.
// Click any photo to open a lightbox.
export function CourtPhotoGrid({ photos, className = "" }: Props) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (photos.length === 0) return null;

  const main = photos[0];
  const right = photos.slice(1, 3);
  const extra = Math.max(0, photos.length - 3);

  return (
    <>
      <div
        className={`grid gap-1 rounded-2xl overflow-hidden ${className}`}
        style={{
          gridTemplateColumns: right.length > 0 ? "2fr 1fr" : "1fr",
          height: 260,
        }}
      >
        <button
          type="button"
          onClick={() => setLightboxIndex(0)}
          className="relative bg-gray-100 overflow-hidden group"
          aria-label="Open photo 1"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={main}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        </button>

        {right.length > 0 && (
          <div className="grid gap-1" style={{ gridTemplateRows: `repeat(${right.length}, 1fr)` }}>
            {right.map((url, i) => {
              const idx = i + 1;
              const isLast = i === right.length - 1;
              return (
                <button
                  type="button"
                  key={idx}
                  onClick={() => setLightboxIndex(idx)}
                  className="relative bg-gray-100 overflow-hidden group"
                  aria-label={`Open photo ${idx + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  {isLast && extra > 0 && (
                    <div className="absolute inset-0 bg-black/45 flex items-center justify-center text-white font-semibold text-lg">
                      +{extra} more
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

function Lightbox({
  photos,
  startIndex,
  onClose,
}: {
  photos: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const [i, setI] = useState(startIndex);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") setI((n) => Math.min(photos.length - 1, n + 1));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [photos.length, onClose]);

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
          aria-label="Previous photo"
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
          aria-label="Next photo"
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

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-xs">
        {i + 1} / {photos.length}
      </div>
    </div>
  );
}
