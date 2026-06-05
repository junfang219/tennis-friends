"use client";

import { useState } from "react";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { ComposerModal, type ChatTarget } from "@/components/PostComposer";

/**
 * Composer action that fires off a Looking-for-Player request from inside a
 * chat. Renders one more icon button in the message composer row (matching the
 * existing attach / emoji / send buttons) and, on tap, opens the shared
 * find-players form (ComposerModal) locked to this chat's audience.
 *
 * The created post lands on the author's feed scoped so only the chat audience
 * can see it (via post_targets), and a shared-post card is dropped into the
 * chat. The new card surfaces through the page's own realtime/poll refresh;
 * `onPosted` lets the host page refetch immediately for snappier feedback.
 */
export default function ChatFindPlayerButton({
  chatTarget,
  onPosted,
}: {
  chatTarget: ChatTarget;
  onPosted?: () => void;
}) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-10 h-10 rounded-full bg-court-green-soft/10 text-court-green hover:bg-court-green-soft/20 flex items-center justify-center transition-colors shrink-0"
        title="Looking for a player"
        aria-label="Looking for a player"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
      </button>

      {open && (
        <ComposerModal
          session={session}
          placeholder="Looking for a player…"
          initialFindPlayers
          chatTarget={chatTarget}
          onPost={() => {
            setOpen(false);
            onPosted?.();
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
