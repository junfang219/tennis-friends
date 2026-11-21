import type { Metadata } from "next";
import Link from "next/link";
import { SMS_VERBAL_CONSENT_SCRIPT, SMS_VERBAL_CONSENT_CONFIRMATION } from "@/lib/onboarding/sms-consent";

export const metadata: Metadata = {
  title: "SMS Invitation Consent — TennisFriends",
  description: "The verbal consent process for optional TennisFriends team invitation texts.",
};

export default function SmsConsentPage() {
  return (
    <article className="mx-auto max-w-2xl px-5 py-12 text-gray-700">
      <p className="text-sm font-semibold uppercase tracking-wide text-court-green-light">TennisFriends</p>
      <h1 className="mt-2 font-display text-4xl text-court-green">SMS Invitation Consent</h1>
      <p className="mt-3 text-sm text-gray-600">Last updated November 18, 2026</p>
      <p className="mt-6 leading-relaxed">Team captains obtain the receiving player&apos;s explicit permission in person or by phone before requesting an invitation text. Players can choose an email invitation or shared link instead.</p>

      <section className="mt-10 space-y-3 leading-relaxed">
        <h2 className="font-display text-2xl text-court-green">Read this script to the player</h2>
        <p>Replace [team name] with the actual team name. Read the full script and wait for the player&apos;s answer.</p>
        <blockquote className="rounded-2xl border border-gray-300 bg-white p-5">{SMS_VERBAL_CONSENT_SCRIPT}</blockquote>
      </section>

      <section className="mt-10 space-y-3 leading-relaxed">
        <h2 className="font-display text-2xl text-court-green">After an explicit yes</h2>
        <p>Confirm the player&apos;s permission and receiving mobile number:</p>
        <blockquote className="rounded-2xl border border-gray-300 bg-white p-5">{SMS_VERBAL_CONSENT_CONFIRMATION}</blockquote>
        <p>Keep a private written record of the player&apos;s name and mobile number, team name, date and time, whether the conversation was in person or by phone, and the player&apos;s yes. Identify the captain who obtained consent and the script version used. This is a captain-maintained record; the invitation checkbox alone is not the record of the player&apos;s answer.</p>
        <p>In TennisFriends, select the consent confirmation and send the invitation to that player. An additional invitation requires permission before sending.</p>
      </section>

      <section className="mt-10 space-y-3 leading-relaxed">
        <h2 className="font-display text-2xl text-court-green">If the player declines</h2>
        <p>Do not request an SMS invitation. Offer an email invitation or shared team link. The player can still join the team.</p>
      </section>

      <p className="mt-10 leading-relaxed"><Link href="/terms" className="font-medium text-court-green underline">Terms of Service</Link>{" · "}<Link href="/privacy" className="font-medium text-court-green underline">Privacy Policy</Link>{" · "}<a href="mailto:tennisfriends123@gmail.com" className="font-medium text-court-green underline">Email support</a></p>
    </article>
  );
}
