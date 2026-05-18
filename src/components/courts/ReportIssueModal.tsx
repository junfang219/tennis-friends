"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  courtId: string;
  courtName: string;
  courtAddress: string | null;
  onClose: () => void;
};

const MIN_ISSUE = 10;
const MAX_ISSUE = 2000;

export function ReportIssueModal({ courtId, courtName, courtAddress, onClose }: Props) {
  const [issue, setIssue] = useState("");
  const [reporterEmail, setReporterEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Autofocus + ESC-to-close. Lock body scroll while open.
  useEffect(() => {
    textareaRef.current?.focus();
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

  // Auto-close after success.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1500);
    return () => clearTimeout(t);
  }, [done, onClose]);

  const trimmed = issue.trim();
  const canSubmit = !submitting && !done && trimmed.length >= MIN_ISSUE;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courtId,
          courtName,
          courtAddress,
          issue: trimmed,
          reporterEmail: reporterEmail.trim() || undefined,
        }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = await res.json().catch(() => ({}));
      const msg = body?.error;
      if (res.status === 503) {
        setErrorMessage(msg || "Reporting isn't set up yet.");
      } else if (res.status === 429) {
        setErrorMessage(msg || "Please wait before sending another report.");
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

  // Portal the modal to document.body so it escapes any parent's
  // `pointer-events: none` (e.g. CourtSummaryCard's outer wrapper is
  // pointer-events-none so taps fall through to the map).
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[600] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-issue-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="min-w-0">
            <h3 id="report-issue-title" className="font-semibold text-gray-900 text-sm">
              Report an issue
            </h3>
            <p className="text-[11px] text-gray-500 truncate">
              About: {courtName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
            aria-label="Close report dialog"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-4 py-3 overflow-y-auto">
          {done ? (
            <div className="py-6 text-center">
              <div className="text-2xl mb-1">✓</div>
              <p className="text-sm font-semibold text-court-green">Thanks! Report sent.</p>
              <p className="text-[11px] text-gray-500 mt-1">Closing…</p>
            </div>
          ) : (
            <>
              {/* Optional email */}
              <label className="block">
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
                  Leave blank to report anonymously. If you include it, the developer can reply.
                </p>
              </label>

              {/* Issue */}
              <label className="block mt-3">
                <span className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                  What&apos;s wrong?
                </span>
                <textarea
                  ref={textareaRef}
                  value={issue}
                  onChange={(e) => setIssue(e.target.value.slice(0, MAX_ISSUE))}
                  placeholder="e.g. Wrong address, court closed, broken booking link, pin in wrong spot…"
                  rows={5}
                  disabled={submitting}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 focus:border-court-green focus:outline-none focus:ring-2 focus:ring-court-green/20 disabled:bg-gray-50 resize-y min-h-[6rem]"
                />
                <div className="flex justify-between items-center mt-1">
                  <p className="text-[10px] text-gray-400">
                    {trimmed.length < MIN_ISSUE
                      ? `At least ${MIN_ISSUE} characters.`
                      : `Looks good.`}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {issue.length} / {MAX_ISSUE}
                  </p>
                </div>
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
                  {submitting ? "Sending…" : "Submit"}
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
