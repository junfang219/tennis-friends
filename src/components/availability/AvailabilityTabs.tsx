"use client";

import Link from "next/link";

interface Props {
  groupId: string;
  active: "matches" | "polls";
}

export function AvailabilityTabs({ groupId, active }: Props) {
  const base = "px-4 py-1.5 rounded-full text-sm font-semibold transition-colors";
  const on = "bg-court-green text-white";
  const off = "text-gray-500 hover:bg-gray-100";
  return (
    <div className="flex items-center gap-1 mb-4">
      <Link
        href={`/groups/${groupId}/availability`}
        className={`${base} ${active === "matches" ? on : off}`}
      >
        Matches
      </Link>
      <Link
        href={`/groups/${groupId}/availability/polls`}
        className={`${base} ${active === "polls" ? on : off}`}
      >
        Polls
      </Link>
    </div>
  );
}
