import type { Metadata } from "next";

// Public, auth-free page. The URL (https://mytennisfriends.com/privacy) is
// listed in App Store Connect → TestFlight → Test Information as the Privacy
// Policy URL and is linked from the app's settings. Keep it a plain Server
// Component so it renders for logged-out reviewers and crawlers.

export const metadata: Metadata = {
  title: "Privacy Policy — TennisFriends",
  description:
    "How TennisFriends collects, uses, and protects your information.",
};

const LAST_UPDATED = "June 7, 2026";
const CONTACT_EMAIL = "tennisfriends123@gmail.com";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl text-court-green">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-gray-700">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <p className="text-sm font-semibold uppercase tracking-wide text-court-green-soft">
        TennisFriends
      </p>
      <h1 className="mt-2 font-display text-4xl text-court-green">
        Privacy Policy
      </h1>
      <p className="mt-3 text-sm text-gray-500">Last updated {LAST_UPDATED}</p>

      <p className="mt-6 text-[15px] leading-relaxed text-gray-700">
        TennisFriends (&ldquo;the app,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;)
        is a social app for tennis players in the Seattle area to find partners,
        schedule matches, track their play, and chat. This policy explains what
        information we collect, how we use it, and the choices you have. We
        collect only what the app needs to work, and we do not sell your
        personal information.
      </p>

      <Section title="Information you give us">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account details.</strong> When you register we collect your
            name and email address. If you sign in with Apple or Google, we
            receive the basic profile information those services share (name and
            email). Passwords for email sign-in are handled by our
            authentication provider and are never visible to us.
          </li>
          <li>
            <strong>Player profile.</strong> Information you add to your profile,
            such as your NTRP rating, playing style, preferred surface, general
            location (ZIP code), availability, age range, bio, and a profile
            photo.
          </li>
          <li>
            <strong>Content you create.</strong> Posts, match results, sessions
            and events you organize or RSVP to, clubs and groups you join, and
            messages you send in direct chats and group chats.
          </li>
        </ul>
      </Section>

      <Section title="Information collected automatically">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Location.</strong> With your permission, the app uses your
            device&rsquo;s location to show nearby players and courts and, when
            you tap to check in, to report court availability. Location is used
            at the moment you request these features; we do not track your
            location continuously in the background.
          </li>
          <li>
            <strong>Device &amp; usage data.</strong> Basic technical
            information such as device type, app version, and approximate region,
            used to operate the service.
          </li>
          <li>
            <strong>Diagnostics.</strong> If the app crashes or errors, we may
            collect diagnostic reports (including device and error details) to
            fix problems and improve stability.
          </li>
          <li>
            <strong>Push tokens.</strong> If you enable notifications, we store a
            device push token so we can deliver alerts about messages, RSVPs, and
            sessions.
          </li>
        </ul>
      </Section>

      <Section title="How we use your information">
        <ul className="list-disc space-y-2 pl-5">
          <li>To create and manage your account and profile.</li>
          <li>
            To match you with players and courts and to power scheduling, clubs,
            messaging, and match tracking.
          </li>
          <li>To send notifications you have opted into.</li>
          <li>To keep the app secure, debug issues, and improve features.</li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal information or use it for
          third-party advertising.
        </p>
      </Section>

      <Section title="How your information is shared">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>With other players.</strong> Your name, photo, NTRP rating,
            general area, and the content you post are visible to other users so
            the social features work. You control what you put in your profile
            and posts.
          </li>
          <li>
            <strong>Service providers.</strong> We use trusted vendors to run the
            app, including Supabase (database, authentication, and storage),
            Vercel (hosting), Apple (Sign in with Apple and push notifications),
            and Google (Sign in with Google). They process data only to provide
            their services to us.
          </li>
          <li>
            <strong>Court availability.</strong> When you check real-time court
            availability with Seattle Parks (ActiveNet), the sign-in credentials
            you enter are used only in memory to complete that request and are
            never stored, logged, or saved.
          </li>
          <li>
            <strong>Public tennis data.</strong> Some features (such as opponent
            and league scouting) display publicly available information from
            third-party sources like TennisRecord. We do not share your personal
            information with those sources.
          </li>
          <li>
            <strong>Legal reasons.</strong> We may disclose information if
            required by law or to protect the rights and safety of our users.
          </li>
        </ul>
      </Section>

      <Section title="Data retention">
        <p>
          We keep your information for as long as your account is active. When
          you delete your account, we delete your profile and associated personal
          data, except where we must retain limited records to comply with legal
          obligations.
        </p>
      </Section>

      <Section title="Your choices">
        <ul className="list-disc space-y-2 pl-5">
          <li>Edit or remove profile information at any time in the app.</li>
          <li>
            Turn location and push notifications on or off in your device
            settings.
          </li>
          <li>
            Request deletion of your account and personal data by contacting us
            at the email below.
          </li>
        </ul>
      </Section>

      <Section title="Children's privacy">
        <p>
          TennisFriends is not directed to children under 13, and we do not
          knowingly collect personal information from them. If you believe a
          child has provided us information, please contact us so we can remove
          it.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy from time to time. When we do, we will revise
          the &ldquo;Last updated&rdquo; date above and, for significant changes,
          provide notice in the app.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          Questions about this policy or your data? Email us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-court-green underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
