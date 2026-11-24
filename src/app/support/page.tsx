import type { Metadata } from "next";
import Link from "next/link";
import { supportEmail } from "@/lib/support";

export const metadata: Metadata = {
  title: "TennisFriends Support",
  description: "Get help with your TennisFriends account and app.",
};

export default function SupportPage() {
  return (
    <article className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-display text-4xl text-court-green">TennisFriends Support</h1>
      <p className="mt-4 leading-relaxed text-gray-700">
        Email us for help with your account, courts, teams, or another app feature.
      </p>
      <a
        href={`mailto:${supportEmail}`}
        className="mt-4 inline-block break-words font-semibold text-court-green underline"
      >
        {supportEmail}
      </a>
      <p className="mt-6 leading-relaxed text-gray-700">
        Tell us what happened and which device you use so we can help.
      </p>
      <Link href="/privacy" className="mt-8 inline-block text-court-green underline">
        Privacy Policy
      </Link>
    </article>
  );
}
