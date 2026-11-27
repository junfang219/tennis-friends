import Link from "next/link";
import type { TeamLanding } from "@/lib/teamLanding";

export default function TeamNextActionCard({ landing }: { landing: TeamLanding }) {
  const { role, title, context, details, status, action } = landing;
  return (
    <section aria-label="Team next step" className="mt-4 space-y-3 rounded-2xl border border-court-green/15 bg-surface p-4">
      <div className="space-y-1">
        <p className="text-sm text-gray-600">{context ? `${role} · ${context}` : role}</p>
        <h2 className="break-words text-base font-bold text-gray-900">{title}</h2>
        {details && <p className="break-words text-sm text-gray-700">{details}</p>}
        {status && <p className="text-sm font-medium text-court-green">{status}</p>}
      </div>
      {action && (
        <Link
          href={action.href}
          className={action.secondary
            ? "inline-flex min-h-11 items-center text-sm font-semibold text-court-green underline underline-offset-4"
            : "btn-primary min-h-11 w-full text-center"}
        >
          {action.label}
        </Link>
      )}
    </section>
  );
}
