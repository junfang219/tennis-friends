"use client";

import { useState } from "react";

export default function PrivacyNotice() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-court-green/5 rounded-xl border border-court-green/10 px-4 py-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#2D6A4F"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <span className="text-xs font-semibold text-court-green">
            Privacy & Booking
          </span>
        </div>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6b7280"
          strokeWidth="2"
          strokeLinecap="round"
          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="mt-3 space-y-2 text-xs text-gray-600">
          <p>
            Court bookings are handled directly through{" "}
            <span className="font-medium text-gray-800">Seattle Parks & Recreation</span>{" "}
            via their ActiveNet reservation system.
          </p>
          <ul className="space-y-1.5 ml-1">
            <li className="flex items-start gap-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="#2D6A4F"
                className="mt-0.5 flex-shrink-0"
              >
                <path d="M20 6L9 17l-5-5" stroke="#2D6A4F" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Credentials are sent securely to Seattle Parks and immediately discarded
            </li>
            <li className="flex items-start gap-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="#2D6A4F"
                className="mt-0.5 flex-shrink-0"
              >
                <path d="M20 6L9 17l-5-5" stroke="#2D6A4F" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Session cookies are cached for 30 minutes, then automatically deleted
            </li>
            <li className="flex items-start gap-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="#2D6A4F"
                className="mt-0.5 flex-shrink-0"
              >
                <path d="M20 6L9 17l-5-5" stroke="#2D6A4F" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Real-time availability is fetched directly from Seattle Parks
            </li>
            <li className="flex items-start gap-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="#2D6A4F"
                className="mt-0.5 flex-shrink-0"
              >
                <path d="M20 6L9 17l-5-5" stroke="#2D6A4F" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              All data is transmitted securely over HTTPS
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
