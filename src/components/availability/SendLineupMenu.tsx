"use client";

// The captain's "Send lineup" control on each match in the Matches tab.
// Tapping it opens a labeled menu with two destinations for the same
// generated lineup text: post it to the in-app team chat, or hand it to the
// native iOS share sheet (Messages / iMessage). Panel behavior (portal,
// positioning, outside-click) comes from the shared ActionMenu.

import ActionMenu from "@/components/ActionMenu";

interface SendLineupMenuProps {
  /** Whether any player is assigned to a slot; disables the trigger when false. */
  hasLineup: boolean;
  /** A chat post is in flight — shows "..." and blocks re-taps. */
  sending: boolean;
  /** The lineup was just posted to chat — shows the check-mark + "Sent". */
  justSent: boolean;
  onPostToChat: () => void;
  onSendViaMessages: () => void;
}

export default function SendLineupMenu({
  hasLineup,
  sending,
  justSent,
  onPostToChat,
  onSendViaMessages,
}: SendLineupMenuProps) {
  return (
    <ActionMenu
      header="Send lineup to…"
      width={240}
      items={[
        {
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          ),
          title: "Team chat",
          subtitle: "Posts in the team feed for everyone",
          onSelect: onPostToChat,
        },
        {
          icon: (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
            </svg>
          ),
          title: "iMessage",
          subtitle: "Opens the share sheet",
          onSelect: onSendViaMessages,
        },
      ]}
      trigger={({ ref, open, toggle }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          disabled={!hasLineup || sending}
          className={`text-[10px] font-semibold px-2 py-1 rounded-md inline-flex items-center gap-1 transition-colors ${
            justSent
              ? "bg-green-100 text-green-700"
              : hasLineup
              ? "bg-court-green text-white hover:bg-court-green-light"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
          title={hasLineup ? "Send lineup" : "Assign lineup slots first"}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {sending ? (
            "..."
          ) : justSent ? (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20,6 9,17 4,12" />
              </svg>
              Sent
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Send lineup
            </>
          )}
        </button>
      )}
    />
  );
}
