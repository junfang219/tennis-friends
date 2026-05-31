"use client";

import { useIsDesktopChat } from "@/hooks/useIsDesktopChat";
import ConversationSidebar from "./ConversationSidebar";

// Two-pane Instagram-style chat shell. On md+ viewports, renders the
// conversation list on the left and the routed child (a chat thread or the
// empty-state placeholder) on the right. On smaller viewports, falls through
// to children so today's mobile behavior (portaled fullscreen threads with
// the back-arrow) keeps working unchanged.
//
// The right pane is `relative` so each thread page can use `absolute inset-0`
// instead of `fixed inset-0` when desktop — that keeps the thread contained
// to the right pane instead of covering the navbar + sidebar.
export default function ChatDesktopShell({ children }: { children: React.ReactNode }) {
  const isDesktop = useIsDesktopChat();

  if (!isDesktop) return <>{children}</>;

  return (
    <div
      className="flex w-full bg-surface"
      // Sit flush under the sticky navbar (h-16 = 4rem) and consume the rest
      // of the dynamic viewport. dvh handles iOS Safari's collapsing chrome
      // gracefully; the safe-area top padding mirrors the navbar's.
      style={{ height: "calc(100dvh - 4rem - env(safe-area-inset-top))" }}
    >
      <ConversationSidebar />
      <div className="flex-1 relative bg-surface overflow-hidden">
        {children}
      </div>
    </div>
  );
}
