"use client";

import { useActionState } from "react";
import { decideContentReport } from "./actions";

export default function ReviewControls({ id, retryMedia = false }: { id: string; retryMedia?: boolean }) {
  const [state, action, pending] = useActionState(decideContentReport, { error: "", message: "" });
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        if (submitter instanceof HTMLButtonElement && submitter.value === "removed" &&
            !window.confirm("Remove this content for everyone?")) event.preventDefault();
      }}
      className="mt-4"
    >
      <input type="hidden" name="reportId" value={id} />
      <div className="flex flex-wrap gap-2">
        {retryMedia ? (
          <button name="decision" value="retry_media" disabled={pending} className="min-h-11 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white">
            Retry attachment removal
          </button>
        ) : (
          <>
            <button name="decision" value="dismissed" disabled={pending} className="min-h-11 rounded-lg border border-gray-400 px-3 text-sm font-medium text-gray-800">
              Dismiss report
            </button>
            <button name="decision" value="removed" disabled={pending} className="min-h-11 rounded-lg bg-red-700 px-3 text-sm font-semibold text-white">
              Remove content
            </button>
          </>
        )}
      </div>
      {state.error && <p role="alert" className="mt-2 text-sm text-red-700">{state.error}</p>}
      {state.message && <p role="status" className="mt-2 text-sm text-gray-700">{state.message}</p>}
    </form>
  );
}
