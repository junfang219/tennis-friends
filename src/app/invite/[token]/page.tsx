"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { validateInvite, acceptInvite } from "@/lib/supabase/queries";
import { errorMessage } from "@/lib/errorMessage";

type InviteInfo = {
  status: "PENDING" | "ACCEPTED" | "CANCELLED" | "EXPIRED";
  expiresAt: string;
  team: { id: string; name: string; imageUrl: string };
  inviterName: string;
};

export default function InviteAcceptPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const token = params.token as string;

  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  const loadInvite = useCallback(async () => {
    setLoadError("");
    try {
      const supabase = createSupabaseBrowserClient();
      const row = await validateInvite(supabase, token);
      if (!row) {
        setLoadError("This invite link is invalid.");
        return;
      }
      // The DB enum is only 'pending' | 'accepted' | 'cancelled' —
      // "expired" is a client-side derivation from a pending row
      // with a past expires_at. Without this check the EXPIRED UI
      // branch was dead code and clicking Join just surfaced the
      // server error.
      const dbStatus = row.status.toUpperCase() as InviteInfo["status"];
      const isExpired =
        row.status === "pending" &&
        row.expires_at != null &&
        new Date(row.expires_at).getTime() < Date.now();
      setInfo({
        status: isExpired ? "EXPIRED" : dbStatus,
        expiresAt: row.expires_at,
        team: {
          id: row.group?.id ?? row.group_id,
          name: row.group?.name ?? "",
          imageUrl: row.group?.image_url ?? "",
        },
        inviterName:
          (row as unknown as { inviter_name?: string }).inviter_name || "",
      });
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load the invite."));
    }
  }, [token]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadInvite();
  }, [loadInvite]);

  const accept = async () => {
    setAccepting(true);
    setAcceptError("");
    try {
      const supabase = createSupabaseBrowserClient();
      // accept_group_invite RPC re-validates token + email + expiry +
      // status server-side, so the client doesn't need to pre-check.
      const result = await acceptInvite(supabase, token);
      router.push(`/groups/${result.groupId}`);
    } catch (err) {
      setAcceptError(errorMessage(err, "Couldn't accept the invite."));
      setAccepting(false);
    }
  };

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

  if (info.status === "CANCELLED") {
    return (
      <InviteShell info={info}>
        <p className="text-sm text-gray-500 mt-3">This invite was cancelled.</p>
      </InviteShell>
    );
  }
  if (info.status === "ACCEPTED") {
    return (
      <InviteShell info={info}>
        <p className="text-sm text-gray-500 mt-3">This invite has already been used.</p>
        {sessionStatus === "authenticated" && (
          <Link href={`/groups/${info.team.id}`} className="btn-primary mt-4 inline-block">
            Open team
          </Link>
        )}
      </InviteShell>
    );
  }
  if (info.status === "EXPIRED") {
    return (
      <InviteShell info={info}>
        <p className="text-sm text-gray-500 mt-3">This invite has expired. Ask your team manager for a new one.</p>
      </InviteShell>
    );
  }

  // PENDING
  if (sessionStatus === "loading") {
    return (
      <Centered>
        <div className="skeleton w-64 h-6 rounded mx-auto" />
      </Centered>
    );
  }
  if (sessionStatus === "unauthenticated") {
    const next = `/invite/${token}`;
    return (
      <InviteShell info={info}>
        <p className="text-sm text-gray-500 mt-3">
          Sign in to accept this invite.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="btn-primary mt-4 inline-block"
        >
          Sign in to accept
        </Link>
      </InviteShell>
    );
  }

  return (
    <InviteShell info={info}>
      <p className="text-sm text-gray-500 mt-3">
        Signed in as <span className="font-medium text-gray-800">{session?.user?.email || session?.user?.name}</span>.
      </p>
      {acceptError && (
        <p className="mt-3 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {acceptError}
        </p>
      )}
      <button onClick={accept} disabled={accepting} className="btn-primary mt-4 w-full">
        {accepting ? "Joining..." : `Join ${info.team.name}`}
      </button>
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

function InviteShell({ info, children }: { info: InviteInfo; children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="bg-white rounded-3xl shadow-sm border border-court-green-pale/20 p-8 text-center">
        {info.team.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={info.team.imageUrl}
            alt={info.team.name}
            className="w-16 h-16 mx-auto rounded-2xl object-cover shadow-sm"
          />
        ) : (
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-2xl">
            {info.team.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="font-display text-2xl font-bold text-gray-900 mt-4">{info.team.name}</h1>
        <p className="text-sm text-gray-500 mt-2">
          <span className="font-medium text-gray-800">{info.inviterName}</span> invited you to join this team on TennisFriend.
        </p>
        {children}
      </div>
    </div>
  );
}
