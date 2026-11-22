"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { useIsNative } from "@/hooks/useIsNative";
import { useKeyboardHeight } from "@/hooks/useKeyboardHeight";
import { contentReportSchema, reportReasons, type ReportTarget } from "@/lib/moderation/contracts";

export type ReportContentTarget = { targetType: ReportTarget; targetId: string };

const responseSchema = z.object({
  ok: z.literal(true),
  duplicate: z.boolean(),
  blockFailed: z.boolean(),
});
const errorSchema = z.object({ error: z.string() });

export function ReportContentDialog({ target, onClose }: { target: ReportContentTarget; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const isNative = useIsNative();
  const keyboardHeight = useKeyboardHeight();
  const nativeKeyboardHeight = isNative ? keyboardHeight : 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    // Let a screen reader announce the dialog before focusing a form control.
    title.current?.setAttribute("autofocus", "");
    element.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError("");
    const data = new FormData(event.currentTarget);
    const input = contentReportSchema.safeParse({
      ...target,
      reason: data.get("reason"),
      details: data.get("details"),
      blockAuthor: data.has("blockAuthor"),
    });
    if (!input.success) {
      setError("Choose a reason. If you select Something else, add a short description.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/content-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input.data),
      });
      const body: unknown = await response.json();
      const parsed = responseSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        const failure = errorSchema.safeParse(body);
        setError(failure.success ? failure.data.error : "Couldn’t send the report. Try again.");
        return;
      }
      const message = parsed.data.duplicate
        ? "You’ve already reported this content."
        : "Report sent. A moderator will review it.";
      setResult(message + (parsed.data.blockFailed
        ? " The account couldn’t be blocked. You can try blocking it again."
        : input.data.blockAuthor ? " Account blocked." : ""));
    } catch {
      setError("Couldn’t send the report. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={event => { if (busy) event.preventDefault(); }}
      style={nativeKeyboardHeight > 0 ? {
        bottom: nativeKeyboardHeight,
        maxHeight: "calc(100dvh - " + nativeKeyboardHeight + "px - 2rem)",
      } : undefined}
      className="fixed inset-0 m-auto max-h-[80dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl bg-white p-5 text-gray-900 shadow-xl backdrop:bg-black/50"
    >
      <h2 ref={title} id={titleId} tabIndex={-1} className="font-display text-xl font-bold text-court-green">Report content</h2>
      {result ? (
        <>
          <p role="status" className="mt-3 text-sm text-gray-800">{result}</p>
          <button type="button" onClick={() => dialog.current?.close()} className="mt-4 min-h-11 rounded-lg bg-court-green px-4 text-sm font-semibold text-white">
            Done
          </button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label htmlFor={titleId + "-reason"} className="block text-sm font-semibold">Reason</label>
            <select id={titleId + "-reason"} name="reason" required defaultValue="" className="mt-1 block min-h-11 w-full rounded-lg border border-gray-400 bg-white px-3 text-base">
              <option value="" disabled>Choose a reason</option>
              {Object.entries(reportReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={titleId + "-details"} className="block text-sm font-semibold">Details (required for Something else)</label>
            <textarea id={titleId + "-details"} name="details" rows={3} maxLength={1000} className="mt-1 block w-full rounded-lg border border-gray-400 p-2 text-base" />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="blockAuthor" className="h-4 w-4 accent-court-green" />
            Also block this account
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => dialog.current?.close()} className="min-h-11 rounded-lg border border-gray-400 px-4 text-sm font-semibold">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-court-green px-4 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "Sending…" : "Send report"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function ReportContentButton({ targetType, targetId, label }: ReportContentTarget & { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        onClick={() => setOpen(true)}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus-visible:outline focus-visible:outline-court-green"
      >
        <ReportFlag />
      </button>
      {open && <ReportContentDialog target={{ targetType, targetId }} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReportFlag() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 21V4c4-4 10 4 14 0v10c-4 4-10-4-14 0" />
    </svg>
  );
}
