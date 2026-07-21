"use client";

// One-time explainer card. Hidden until mounted (no SSR/hydration flash),
// shows only while its seenFlags key is unseen, and "Got it" dismisses it
// permanently for this device. Reusable: pass a distinct storageKey per tip.

import { ReactNode, useEffect, useState } from "react";
import { hasSeenFlag, markFlagSeen } from "@/lib/seenFlags";

export default function DismissibleTip({
  storageKey,
  title,
  children,
  className = "",
}: {
  storageKey: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(!hasSeenFlag(storageKey));
  }, [storageKey]);

  if (!visible) return null;

  return (
    <div
      className={`flex items-start gap-3 p-3.5 rounded-2xl border border-court-green-pale/60 bg-court-green-pale/20 animate-fade-in-up ${className}`}
      role="note"
    >
      <div className="w-7 h-7 rounded-full bg-court-green/10 flex items-center justify-center shrink-0 mt-0.5">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-court-green">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{title}</p>
        <div className="text-xs text-gray-600 mt-0.5 leading-relaxed">{children}</div>
      </div>
      <button
        onClick={() => {
          markFlagSeen(storageKey);
          setVisible(false);
        }}
        className="shrink-0 text-xs font-semibold text-court-green hover:text-court-green-light px-2 py-1 rounded-lg hover:bg-court-green-pale/40"
      >
        Got it
      </button>
    </div>
  );
}
