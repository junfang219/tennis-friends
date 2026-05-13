"use client";

import { useState } from "react";

type DisplayProps = {
  value: number;
  size?: number;
  className?: string;
};

// Read-only star row that supports half-stars. Renders five SVGs and clips a
// gold overlay to `value / 5` of the total width.
export function StarRating({ value, size = 16, className = "" }: DisplayProps) {
  const clamped = Math.max(0, Math.min(5, value));
  const widthPct = (clamped / 5) * 100;
  const totalWidth = size * 5 + 4 * 2; // gap accounted for inline below

  return (
    <div
      className={`relative inline-block ${className}`}
      style={{ width: totalWidth, height: size }}
      aria-label={`${clamped.toFixed(1)} out of 5 stars`}
      role="img"
    >
      <div className="absolute inset-0 flex gap-0.5 text-gray-300">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={size} filled />
        ))}
      </div>
      <div
        className="absolute inset-0 overflow-hidden flex gap-0.5 text-amber-400"
        style={{ width: `${widthPct}%` }}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} size={size} filled />
        ))}
      </div>
    </div>
  );
}

type InputProps = {
  value: number;
  onChange: (v: number) => void;
  size?: number;
};

export function StarRatingInput({ value, onChange, size = 32 }: InputProps) {
  const [hover, setHover] = useState(0);
  const display = hover || value;
  return (
    <div className="inline-flex items-center gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="p-0.5 rounded-md hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-300 transition-colors"
        >
          <span className={n <= display ? "text-amber-400" : "text-gray-300"}>
            <Star size={size} filled />
          </span>
        </button>
      ))}
    </div>
  );
}

function Star({ size, filled }: { size: number; filled: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <polygon points="12 2 15.1 8.6 22 9.6 17 14.5 18.2 21.5 12 18.2 5.8 21.5 7 14.5 2 9.6 8.9 8.6" />
    </svg>
  );
}
