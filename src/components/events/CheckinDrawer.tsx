"use client";

import { useState } from "react";
import Avatar from "@/components/Avatar";

type Participant = {
  id: string;
  userId: string;
  status: "registered" | "waitlist" | "withdrawn";
  checkedInAt: string | null;
  user: {
    id: string;
    name: string;
    profileImageUrl: string;
  };
};

export default function CheckinDrawer({
  eventId,
  participants,
  onClose,
  onChanged,
}: {
  eventId: string;
  participants: Participant[];
  onClose: () => void;
  onChanged?: () => void;
}) {
  const registered = participants.filter((p) => p.status === "registered");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [localState, setLocalState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(registered.map((p) => [p.userId, p.checkedInAt != null]))
  );

  async function toggle(userId: string) {
    const next = !localState[userId];
    setPending(userId);
    setError("");
    const res = await fetch(`/api/events/${eventId}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, checkedIn: next }),
    });
    setPending(null);
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      setError(d?.error || "Couldn't update check-in");
      return;
    }
    setLocalState((prev) => ({ ...prev, [userId]: next }));
    onChanged?.();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="font-display text-lg font-bold text-gray-900">
              Check players in
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Only checked-in players are paired in mixer rounds.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {error && (
          <div className="mx-5 mt-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <ul className="overflow-y-auto p-3 space-y-1">
          {registered.length === 0 && (
            <li className="text-sm text-gray-500 text-center py-6">
              No one is registered yet.
            </li>
          )}
          {registered.map((p) => {
            const isIn = !!localState[p.userId];
            const busy = pending === p.userId;
            return (
              <li key={p.id}>
                <button
                  onClick={() => toggle(p.userId)}
                  disabled={busy}
                  className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition-colors text-left ${
                    isIn ? "bg-court-green/10" : "hover:bg-gray-50"
                  }`}
                >
                  <Avatar name={p.user.name} image={p.user.profileImageUrl} size="sm" />
                  <span className="flex-1 text-sm font-medium text-gray-800 truncate">
                    {p.user.name}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      isIn
                        ? "bg-court-green text-white"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {busy ? "…" : isIn ? "Checked in" : "Tap to check in"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
