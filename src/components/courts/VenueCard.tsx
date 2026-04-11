"use client";

import Link from "next/link";

interface VenueCardProps {
  id: string;
  name: string;
  address: string;
  courts: number;
  surface: string;
  lit: boolean;
  distance?: number; // miles from user
}

export default function VenueCard({
  id,
  name,
  address,
  courts,
  surface,
  lit,
  distance,
}: VenueCardProps) {
  return (
    <Link
      href={`/courts/${id}`}
      className="block bg-white rounded-xl border border-gray-100 hover:border-court-green-pale/50 hover:shadow-md transition-all p-4 group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm text-gray-900 group-hover:text-court-green transition-colors truncate">
            {name}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{address}</p>

          {/* Tags */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-court-green/10 text-court-green text-[11px] font-medium">
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
              {courts} court{courts !== 1 ? "s" : ""}
            </span>

            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[11px] font-medium capitalize">
              {surface}
            </span>

            {lit && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ball-yellow/20 text-amber-700 text-[11px] font-medium">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 2v3m0 14v3M4.93 4.93l2.12 2.12m9.9 9.9l2.12 2.12M2 12h3m14 0h3M4.93 19.07l2.12-2.12m9.9-9.9l2.12-2.12M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
                Lights
              </span>
            )}
          </div>
        </div>

        {/* Distance badge */}
        <div className="flex-shrink-0 text-right">
          {distance !== undefined && (
            <span className="text-xs font-medium text-gray-500">
              {distance < 0.1
                ? "Nearby"
                : `${distance.toFixed(1)} mi`}
            </span>
          )}
          <div className="mt-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#9ca3af"
              strokeWidth="2"
              strokeLinecap="round"
              className="group-hover:stroke-court-green transition-colors"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </div>
      </div>
    </Link>
  );
}
