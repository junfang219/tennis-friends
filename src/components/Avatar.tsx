"use client";

const COLORS = [
  "bg-court-green-soft",
  "bg-clay",
  "bg-court-green-light",
  "bg-court-green-pale",
  "bg-clay-light",
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export default function Avatar({
  name,
  image,
  size = "md",
}: {
  name: string;
  image?: string | null;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizeClasses = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-14 h-14 text-lg",
    xl: "w-24 h-24 text-3xl",
  };

  const initials = name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const colorClass = COLORS[hashName(name) % COLORS.length];

  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className={`${sizeClasses[size]} rounded-full object-cover ring-2 ring-white/80 shadow-sm`}
      />
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} ${colorClass} rounded-full flex items-center justify-center font-bold text-white ring-2 ring-white/80 shadow-sm`}
    >
      {initials}
    </div>
  );
}
