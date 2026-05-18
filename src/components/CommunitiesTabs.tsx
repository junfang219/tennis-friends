"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function CommunitiesTabs() {
  const pathname = usePathname();
  const isEvents = pathname.startsWith("/events");
  const isTeams = !isEvents;

  return (
    <div className="flex items-center gap-1 mb-5 bg-gray-100 p-1 rounded-full w-fit mx-auto">
      <Link
        href="/groups"
        prefetch
        aria-current={isTeams ? "page" : undefined}
        className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
          isTeams ? "bg-white text-court-green shadow-sm" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        Teams
      </Link>
      <Link
        href="/events"
        prefetch
        aria-current={isEvents ? "page" : undefined}
        className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
          isEvents ? "bg-white text-court-green shadow-sm" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        Events
      </Link>
    </div>
  );
}
