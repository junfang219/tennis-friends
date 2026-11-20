import Link from "next/link";

const links = [
  { href: "/courts", label: "Find courts" },
  { href: "/bookings", label: "My bookings" },
  { href: "/courts/alerts", label: "Court Alerts" },
] as const;

export function CourtsSectionNav({ active }: { active: (typeof links)[number]["href"] }) {
  return (
    <nav aria-label="Courts section" className="shrink-0 border-b border-gray-200 bg-white">
      <div className="mx-auto grid max-w-5xl grid-cols-3 gap-2 px-4 sm:flex sm:gap-4 sm:px-6">
        {links.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={active === href ? "page" : undefined}
            className={`inline-flex min-h-11 items-center justify-center border-b-2 px-1.5 text-center text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-court-green sm:px-3 ${
              active === href
                ? "border-court-green text-court-green"
                : "border-transparent text-gray-600 hover:border-gray-300 hover:text-court-green"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
