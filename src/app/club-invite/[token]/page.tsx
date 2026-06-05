"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getClubInviteLink, acceptClubInviteLink } from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

type LinkInfo = {
  friendGroupId: string;
  clubName: string;
  inviterName: string;
};

/**
 * Reusable club QR landing page. A non-user scans the club QR (or taps the
 * link) and arrives here. Web-first: they create an account, and the
 * ?next=/club-invite/<token> thread brings them back here authenticated,
 * where we auto-join them to the club and drop them in the club chat.
 */
export default function ClubInviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const token = params.token as string;

  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  const loadLink = useCallback(async () => {
    setLoadError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const row = await getClubInviteLink(supabase, token);
      if (!row) {
        setLoadError("This invite link is invalid.");
        return;
      }
      setInfo(row);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load the invite."));
    }
  }, [token]);

  useEffect(() => {
    void loadLink();
  }, [loadLink]);

  const accept = useCallback(async () => {
    setAccepting(true);
    setAcceptError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const result = await acceptClubInviteLink(supabase, token);
      // Land straight in the club chat — the hub a new joiner wants.
      router.push(result.chatId ? `/chat/group/${result.chatId}` : "/friends");
    } catch (err) {
      setAcceptError(errorMessage(err, "Couldn't accept the invite."));
      setAccepting(false);
    }
  }, [router, token]);

  // Auto-accept once the visitor is signed in — scanning/clicking the link is
  // the consent. The ref guards against re-fires from dep changes.
  const autoAttempted = useRef(false);
  useEffect(() => {
    if (!autoAttempted.current && info && sessionStatus === "authenticated") {
      autoAttempted.current = true;
      void accept();
    }
  }, [info, sessionStatus, accept]);

  if (loadError) {
    return (
      <Centered>
        <p className="text-gray-500">{loadError}</p>
        <Link href="/" className="btn-primary mt-4 inline-block">Go home</Link>
      </Centered>
    );
  }
  if (!info) {
    return (
      <Centered>
        <div className="skeleton w-64 h-6 rounded mx-auto" />
      </Centered>
    );
  }

  if (sessionStatus === "loading") {
    return (
      <Centered>
        <div className="skeleton w-64 h-6 rounded mx-auto" />
      </Centered>
    );
  }

  if (sessionStatus === "unauthenticated") {
    const next = `/club-invite/${token}`;
    return (
      <InviteShell info={info}>
        <p className="text-sm text-gray-500 mt-3">
          Create your free account to join — you&apos;ll land right in the {info.clubName} chat.
        </p>
        <Link
          href={`/register?next=${encodeURIComponent(next)}`}
          className="btn-primary mt-4 w-full inline-block"
        >
          Create account &amp; join
        </Link>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="mt-3 inline-block text-sm font-medium text-court-green hover:underline"
        >
          Already have an account? Sign in
        </Link>
      </InviteShell>
    );
  }

  // Authenticated — auto-accepting (or showing a retry on failure).
  return (
    <InviteShell info={info}>
      {acceptError ? (
        <>
          <p className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {acceptError}
          </p>
          <button
            onClick={() => void accept()}
            disabled={accepting}
            className="btn-primary mt-4 w-full"
          >
            {accepting ? "Joining..." : "Try again"}
          </button>
        </>
      ) : (
        <p className="mt-4 text-sm text-gray-500">Joining {info.clubName}…</p>
      )}
    </InviteShell>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="text-center max-w-sm">{children}</div>
    </div>
  );
}

function InviteShell({ info, children }: { info: LinkInfo; children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="bg-white rounded-3xl shadow-sm border border-court-green-pale/20 p-8 text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-2xl">
          {info.clubName.charAt(0).toUpperCase()}
        </div>
        <h1 className="font-display text-2xl font-bold text-gray-900 mt-4">{info.clubName}</h1>
        <p className="text-sm text-gray-500 mt-2">
          <span className="font-medium text-gray-800">{info.inviterName || "A friend"}</span> invited you to join this club on TennisFriend.
        </p>
        {children}
      </div>
    </div>
  );
}
