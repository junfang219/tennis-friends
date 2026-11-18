import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — TennisFriends",
  description: "Terms for using TennisFriends, including optional team invitation text messages.",
};

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-2xl px-5 py-12 text-gray-700">
      <p className="text-sm font-semibold uppercase tracking-wide text-court-green-light">TennisFriends</p>
      <h1 className="mt-2 font-display text-4xl text-court-green">Terms of Service</h1>
      <p className="mt-3 text-sm text-gray-600">Last updated November 18, 2026</p>
      <p className="mt-6 leading-relaxed">TennisFriends is a personal project that helps tennis players organize teams, invitations, and tennis activities. These terms describe use of the service and its optional SMS invitation program.</p>

      <section className="mt-10 space-y-3 leading-relaxed">
        <h2 className="font-display text-2xl text-court-green">Using TennisFriends</h2>
        <p>Provide accurate information, respect other players, and use invitation links intended for you. Team captains are responsible for the accuracy of team and registration details they enter and for obtaining permission before requesting an SMS invitation for a player.</p>
      </section>

      <section className="mt-10 space-y-3 leading-relaxed">
        <h2 className="font-display text-2xl text-court-green">SMS Terms</h2>
        <p><strong>Program and messages.</strong> TennisFriends sends personal team invitations by text after the receiving player explicitly agrees. An invitation includes a team link and may include optional USTA registration instructions, a team number, and a deadline.</p>
        <p><strong>Consent and frequency.</strong> A captain asks the player in person or by phone using the <Link href="/sms-consent" className="font-medium text-court-green underline">verbal consent script</Link>, obtains an explicit yes, confirms the receiving number, and keeps a dated record of permission. The player receives one invitation for that request. Captains must obtain permission before sending an additional invitation.</p>
        <p><strong>Your choice.</strong> SMS consent is optional. You may decline and ask the captain for an email invitation or shared team link. Agreeing to general service terms or providing a phone number alone does not establish SMS consent.</p>
        <p><strong>Charges.</strong> Message and data rates may apply. Your mobile provider determines any charges to you.</p>
        <p><strong>Opt out.</strong> Reply STOP to opt out of TennisFriends SMS messages. You may receive an opt-out confirmation. For an alternative invitation method, contact your captain.</p>
        <p><strong>Help.</strong> Reply HELP for help, or email <a href="mailto:tennisfriends123@gmail.com" className="font-medium text-court-green underline">tennisfriends123@gmail.com</a>.</p>
        <p><strong>Delivery.</strong> Message delivery depends on mobile carriers and network availability. An invitation link remains subject to its expiry and revocation.</p>
        <p><strong>Privacy.</strong> See the <Link href="/privacy" className="font-medium text-court-green underline">Privacy Policy</Link> for how TennisFriends uses phone numbers, invitation details, and SMS information.</p>
      </section>

      <section className="mt-10 space-y-3 leading-relaxed">
        <h2 className="font-display text-2xl text-court-green">Contact and updates</h2>
        <p>Questions about TennisFriends or these terms can be sent to <a href="mailto:tennisfriends123@gmail.com" className="font-medium text-court-green underline">tennisfriends123@gmail.com</a>. Updates will appear on this page with a revised date.</p>
      </section>
    </article>
  );
}
