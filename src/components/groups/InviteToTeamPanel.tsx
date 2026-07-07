"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { TEAM_ROLES, type TeamRole } from "@/lib/groupRoles";
import { errorMessage } from "@/lib/errorMessage";

/**
 * "Invite to the team" — the REAL-member path: email/phone/invite-link →
 * `group_invites` → the recipient signs up and becomes a member. Extracted from
 * the settings Roster tab so it can also be hosted by AddPeopleChooser. Manager-
 * gated by the caller (only rendered for people who can manage the team).
 */
type Invite = {
  id: string;
  email: string | null;
  token: string;
  roles: TeamRole[];
  memberType: string;
  status: string;
  createdAt: string;
  invitedBy: { id: string; name: string };
};

// Human label for a role set: "Manager · Captain", or "Member" when empty.
function rolesLabel(roles: TeamRole[]): string {
  if (roles.length === 0) return "Member";
  return TEAM_ROLES.filter((r) => roles.includes(r.value)).map((r) => r.label).join(" · ");
}

export default function InviteToTeamPanel({
  groupId,
  groupName,
  memberTypes,
  callerIsOwner,
  currentUserName,
}: {
  groupId: string;
  groupName: string;
  memberTypes: string[];
  callerIsOwner: boolean;
  currentUserName: string;
}) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteChannel, setInviteChannel] = useState<"email" | "phone">("email");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoles, setInviteRoles] = useState<TeamRole[]>([]);
  const [inviteType, setInviteType] = useState("");
  const [sending, setSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState("");
  const [inviteErr, setInviteErr] = useState("");

  const loadInvites = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase
      .from("group_invites")
      .select(
        `id, email, token, roles, member_type, status, created_at, invited_by_id,
         invitedBy:profiles!group_invites_invited_by_id_fkey ( id, name )`
      )
      .eq("group_id", groupId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    type Row = {
      id: string;
      email: string | null;
      token: string;
      roles: TeamRole[];
      member_type: string;
      status: string;
      created_at: string;
      invited_by_id: string;
      invitedBy: { id: string; name: string } | { id: string; name: string }[] | null;
    };
    setInvites(
      ((data ?? []) as unknown as Row[]).map((i) => {
        const inviter = Array.isArray(i.invitedBy) ? i.invitedBy[0] : i.invitedBy;
        return {
          id: i.id,
          email: i.email,
          token: i.token,
          roles: i.roles,
          memberType: i.member_type,
          status: i.status,
          createdAt: i.created_at,
          invitedBy: inviter ?? { id: i.invited_by_id, name: "Unknown" },
        };
      })
    );
  }, [groupId]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const shareInviteLink = async (token: string) => {
    setInviteErr("");
    setInviteMsg("");
    const link = `${window.location.origin}/invite/${token}`;
    const inviter = currentUserName || "A teammate";
    const message = `${inviter} invited you to join ${groupName} on TennisFriend.`;
    // Prefer the native share sheet (Messages, WhatsApp, Mail…). On HTTPS prod
    // this works; if it's missing or denied, fall back to clipboard.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `Join ${groupName} on TennisFriend`, text: message, url: link });
        return;
      } catch {
        // User cancelled or share unavailable; fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(`${message}\n${link}`);
      setInviteMsg("Invite copied. Open Messages and paste to send.");
    } catch {
      setInviteErr("Couldn't copy automatically — long-press the link to copy.");
    }
  };

  const sendInvite = async () => {
    setInviteErr("");
    setInviteMsg("");
    // Email tab requires an address. Phone tab is no-input — it generates a
    // bearer link (null email) and opens the share sheet.
    let emailToInsert: string | null = null;
    if (inviteChannel === "email") {
      const trimmed = inviteEmail.trim();
      if (!trimmed) return;
      emailToInsert = trimmed;
    }
    setSending(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const { error: insErr } = await supabase.from("group_invites").insert({
        group_id: groupId,
        email: emailToInsert,
        roles: inviteRoles,
        member_type: inviteType,
        token,
        invited_by_id: auth.user.id,
        expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(),
      });
      if (insErr) throw insErr;
      if (emailToInsert) {
        setInviteMsg(`Invite sent to ${emailToInsert}.`);
        void loadInvites();
      } else {
        await loadInvites();
        await shareInviteLink(token);
      }
      setInviteEmail("");
      setInviteType("");
      setInviteRoles([]);
    } catch (err) {
      setInviteErr(errorMessage(err, "Failed to send invite."));
    }
    setSending(false);
  };

  const cancelInvite = async (inviteId: string) => {
    setInviteErr("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: delErr } = await supabase
        .from("group_invites")
        .update({ status: "cancelled" })
        .eq("id", inviteId);
      if (delErr) throw delErr;
      void loadInvites();
    } catch (err) {
      setInviteErr(errorMessage(err, "Failed to cancel invite."));
    }
  };

  return (
    <div className="space-y-5">
      {/* Invite form */}
      <div>
        <div className="p-3 rounded-xl border border-gray-200 bg-gray-50 space-y-2">
          <p className="text-[11px] text-gray-500 leading-snug">
            They&apos;ll create a free account and join as a member — chat, RSVP, see everyone.
          </p>
          <div className="grid grid-cols-2 gap-1 p-0.5 bg-white rounded-lg border border-gray-200">
            {(["email", "phone"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setInviteChannel(c);
                  setInviteMsg("");
                  setInviteErr("");
                }}
                aria-pressed={inviteChannel === c}
                className={`text-xs font-semibold py-1.5 rounded-md transition-colors ${
                  inviteChannel === c ? "bg-court-green text-white" : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {c === "email" ? "Email" : "Phone"}
              </button>
            ))}
          </div>
          {inviteChannel === "email" ? (
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green"
            />
          ) : (
            <p className="text-[11px] text-gray-500 leading-snug px-1">
              Tap Send to generate a link. We&apos;ll open your share sheet so you can text it with a pre-filled message.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Roles</span>
            {TEAM_ROLES.map((r) => {
              const on = inviteRoles.includes(r.value);
              const lockedManager = r.value === "manager" && !callerIsOwner;
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() =>
                    setInviteRoles((prev) =>
                      prev.includes(r.value) ? prev.filter((x) => x !== r.value) : [...prev, r.value]
                    )
                  }
                  disabled={lockedManager}
                  title={lockedManager ? "Only the team owner can assign Manager" : undefined}
                  aria-pressed={on}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                    on
                      ? "bg-court-green text-white border-court-green"
                      : "bg-white text-gray-500 border-gray-200 hover:border-court-green"
                  } ${lockedManager ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <select
            value={inviteType}
            onChange={(e) => setInviteType(e.target.value)}
            disabled={memberTypes.length === 0}
            className="w-full text-xs px-2 py-2 border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-court-green"
          >
            <option value="">No member type</option>
            {memberTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            onClick={sendInvite}
            disabled={sending || (inviteChannel === "email" && !inviteEmail.trim())}
            className="btn-primary w-full"
          >
            {sending ? "Sending..." : inviteChannel === "email" ? "Send invite" : "Generate & share link"}
          </button>
          {inviteMsg && <p className="text-xs text-court-green">{inviteMsg}</p>}
          {inviteErr && <p className="text-xs text-red-600">{inviteErr}</p>}
        </div>
      </div>

      {/* Pending invites */}
      {invites.length > 0 && (
        <div>
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Pending invites</h3>
          <div className="space-y-2">
            {invites.map((inv) => {
              const isLink = !inv.email;
              return (
                <div
                  key={inv.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl border ${
                    isLink ? "border-court-green-pale/40 bg-court-green-pale/10" : "border-gray-100 bg-amber-50/40"
                  }`}
                >
                  {isLink ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-court-green shrink-0">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 shrink-0">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {isLink ? "Invite link" : inv.email}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {isLink ? "Anyone with the link" : "Email queued"} · {inv.invitedBy.name} · {rolesLabel(inv.roles)}{inv.memberType ? ` · ${inv.memberType}` : ""}
                    </p>
                  </div>
                  {isLink && (
                    <button onClick={() => shareInviteLink(inv.token)} className="text-xs font-semibold text-court-green hover:underline">
                      Share
                    </button>
                  )}
                  <button onClick={() => cancelInvite(inv.id)} className="text-xs font-semibold text-red-500 hover:text-red-600">
                    Cancel
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
