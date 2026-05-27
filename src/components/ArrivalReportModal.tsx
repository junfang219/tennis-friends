"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Props = {
  courtId: string;
  venueName: string;
  postId: string;
  onClose: () => void;
};

export function ArrivalReportModal({ courtId, venueName, postId, onClose }: Props) {
  const [submitting, setSubmitting] = useState<"yes" | "no" | null>(null);
  const [done, setDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1200);
    return () => clearTimeout(t);
  }, [done, onClose]);

  async function submit(hasEmpty: boolean) {
    setSubmitting(hasEmpty ? "yes" : "no");
    setErrorMessage(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("report_court_availability", {
        p_court_id: courtId,
        p_has_empty: hasEmpty,
        p_post_id: postId,
      });
      if (!error) {
        setDone(true);
        return;
      }
      setErrorMessage(error.message || "Couldn't send.");
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setSubmitting(null);
    }
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="arrival-report-title"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 id="arrival-report-title" className="font-semibold text-gray-900 text-sm">
              Are there empty courts here?
            </h3>
            <p className="text-[11px] text-gray-500 truncate">{venueName}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
            aria-label="Skip"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-4">
          {done ? (
            <div className="py-3 text-center">
              <div className="text-2xl mb-1">✓</div>
              <p className="text-sm font-semibold text-court-green">Thanks!</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-3">
                Help other players know what&apos;s open right now. Skip if you&apos;re not sure.
              </p>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={submitting !== null}
                  className="w-full px-3 py-2.5 rounded-lg bg-court-green hover:bg-court-green-light text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting === "yes" ? "Sending…" : "Yes, there are open courts"}
                </button>
                <button
                  type="button"
                  onClick={() => submit(false)}
                  disabled={submitting !== null}
                  className="w-full px-3 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 disabled:opacity-50"
                >
                  {submitting === "no" ? "Sending…" : "No, all full"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting !== null}
                  className="w-full px-3 py-2 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
                >
                  Skip
                </button>
              </div>
              {errorMessage && (
                <p className="mt-3 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {errorMessage}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
