"use client";

// BETA FEEDBACK — beta-only; safe to delete this file before public launch.
//
// Simple feedback / feature-request modal modeled on AddMissingCourtModal.
// Posts to /api/feedback, which emails me via Resend.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** Prefills the contact field (the signed-in user's email). */
  defaultEmail?: string;
  onClose: () => void;
};

type Category = "bug" | "feature" | "suggestion" | "other";

const MIN_MESSAGE = 3;
const MAX_MESSAGE = 4000;

export function FeedbackModal({ defaultEmail, onClose }: Props) {
  const [category, setCategory] = useState<Category>("suggestion");
  const [message, setMessage] = useState("");
  const [reporterEmail, setReporterEmail] = useState(defaultEmail ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const messageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messageRef.current?.focus();
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
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const canSubmit = !submitting && !done && message.trim().length >= MIN_MESSAGE;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    const payload: Record<string, unknown> = {
      category,
      message: message.trim(),
    };
    if (reporterEmail.trim()) payload.reporterEmail = reporterEmail.trim();

    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      const msg = body?.error;
      if (res.status === 503) {
        setErrorMessage(msg || "Feedback isn't set up yet.");
      } else if (res.status === 429) {
        setErrorMessage(msg || "Please wait before sending more feedback.");
      } else if (typeof msg === "string") {
        setErrorMessage(msg);
      } else {
        setErrorMessage(`Couldn't send (HTTP ${res.status}). Please try again.`);
      }
    } catch {
      setErrorMessage("Network error. Please try again.");
    } finally {
      setSubmitting(false);
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
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md flex flex-col overflow-hidden
                   max-h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] sm:max-h-[92vh]
                   mb-[calc(4rem+env(safe-area-inset-bottom))] sm:mb-0"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h3 id="feedback-modal-title" className="font-semibold text-gray-900 text-sm">
            Send feedback
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
            aria-label="Close feedback dialog"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0">
          {done ? (
            <div className="py-6 text-center">
              <div className="text-2xl mb-1">✓</div>
              <p className="text-sm font-semibold text-court-green">Thanks! Your feedback was sent.</p>
              <p className="text-[11px] text-gray-500 mt-1">Closing…</p>
            </div>
          ) : (
            <>
              <p className="text-[11px] text-gray-500 mb-3">
                Found a bug, want a feature, or have a suggestion? Send it straight to the developer.
              </p>

              {/* Category */}
              <label className="block">
                <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Type
                </span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as Category)}
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50"
                >
                  <option value="bug">🐞 Bug</option>
                  <option value="feature">✨ Feature request</option>
                  <option value="suggestion">💡 Suggestion</option>
                  <option value="other">💬 Other</option>
                </select>
              </label>

              {/* Message */}
              <label className="block mt-3">
                <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Message <span className="text-red-500">*</span>
                </span>
                <textarea
                  ref={messageRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
                  placeholder="What's on your mind? The more detail, the better."
                  rows={5}
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50 resize-y min-h-[6rem]"
                />
                <p className="text-[10px] text-gray-400 mt-1 text-right">
                  {message.length} / {MAX_MESSAGE}
                </p>
              </label>

              {/* Reporter email */}
              <label className="block mt-2">
                <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Your email (optional)
                </span>
                <input
                  type="email"
                  value={reporterEmail}
                  onChange={(e) => setReporterEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Leave blank to stay anonymous; add it so the developer can reply.
                </p>
              </label>

              {/* Error */}
              {errorMessage && (
                <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {errorMessage}
                </p>
              )}

              {/* Buttons */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-sm font-medium text-gray-700 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSubmit}
                  className="px-3 py-2 rounded-lg bg-court-green hover:bg-court-green-light text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Send"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
