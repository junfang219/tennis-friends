"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import Avatar from "@/components/Avatar";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getOrCreateClubInviteLink, rotateClubInviteLink } from "@/lib/supabase/queries";
import { nativeShare } from "@/lib/lfpShare";
import { publicSiteUrl } from "@/lib/siteUrl";
import { errorMessage } from "@/lib/errorMessage";

type Props = {
  /** friend_groups.id of the club (kind='club'). */
  clubId: string;
  clubName: string;
  /** Display name of the current member, for the share message. */
  inviterName?: string;
  onClose: () => void;
};

/**
 * Reusable club QR invite. Any member opens this to surface a stable QR
 * (and matching link) that a non-user can scan or receive. The QR encodes
 * /club-invite/<token>; the recipient registers, joins, and lands in the
 * club chat. Backed by get_or_create_club_invite_link — one stable code per
 * club, not consumed on use.
 */
export function ClubQRModal({ clubId, clubName, inviterName, onClose }: Props) {
  const [url, setUrl] = useState<string>("");
  const [loadError, setLoadError] = useState("");
  const [shareNote, setShareNote] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Fetch-or-create the stable QR token on open. Opening the modal also slides
  // the link's expiry forward, so a club that's actively inviting never lapses.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { token, isOwner: owner, expiresAt: exp } = await getOrCreateClubInviteLink(supabase, clubId);
        if (cancelled) return;
        setUrl(`${publicSiteUrl()}/club-invite/${token}`);
        setIsOwner(owner);
        setExpiresAt(exp);
      } catch (err) {
        if (cancelled) return;
        setLoadError(errorMessage(err, "Couldn't create the invite."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  const resetLink = useCallback(async () => {
    setResetting(true);
    setShareNote("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { token, expiresAt: exp } = await rotateClubInviteLink(supabase, clubId);
      setUrl(`${publicSiteUrl()}/club-invite/${token}`);
      setExpiresAt(exp);
      setConfirmingReset(false);
      setShareNote("Link reset. The old QR no longer works.");
    } catch (err) {
      setShareNote(errorMessage(err, "Couldn't reset the link."));
    } finally {
      setResetting(false);
    }
  }, [clubId]);

  // ESC-to-close + body scroll lock, matching other app modals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const share = useCallback(async () => {
    if (!url) return;
    setShareNote("");
    const inviter = inviterName?.trim() || "A friend";
    const result = await nativeShare(
      {
        title: `Join ${clubName} on TennisFriend`,
        text: `${inviter} invited you to join ${clubName} on TennisFriend.`,
        url,
      },
      "clubQrShare"
    );
    if (result.outcome === "copied") {
      setShareNote("Link copied — open Messages and paste to send.");
    } else if (result.outcome === "failed") {
      setShareNote(result.error || "Couldn't share automatically — long-press the link to copy.");
    }
  }, [url, clubName, inviterName]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[600] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="club-qr-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar name={clubName} size="sm" />
            <div className="min-w-0">
              <h3 id="club-qr-title" className="font-semibold text-gray-900 text-sm truncate">
                Invite to {clubName}
              </h3>
              <p className="text-[11px] text-gray-500">Scan to join the club chat</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center flex-shrink-0"
            aria-label="Close invite dialog"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 overflow-y-auto text-center">
          {loadError ? (
            <p className="py-8 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3">
              {loadError}
            </p>
          ) : !url ? (
            <div className="py-8">
              <div className="skeleton w-44 h-44 rounded-2xl mx-auto" />
            </div>
          ) : (
            <>
              <div className="inline-flex p-4 bg-white rounded-2xl border border-gray-100 shadow-sm">
                <QRCodeSVG
                  value={url}
                  size={192}
                  level="M"
                  marginSize={0}
                  aria-label={`QR code to join ${clubName}`}
                />
              </div>
              <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                Point a phone camera at this code, or send the link. New to TennisFriend? They can
                sign up and they&apos;ll land right in the {clubName} chat.
              </p>
              {expiresAt && (
                <p className="text-[11px] text-gray-400 mt-2">
                  Expires{" "}
                  {new Date(expiresAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {" "}· refreshes each time you open this. Clubs hold up to 100 members.
                </p>
              )}
              <button
                type="button"
                onClick={() => void share()}
                className="mt-4 w-full px-3 py-2.5 rounded-lg bg-court-green hover:bg-court-green-light text-sm font-semibold text-white"
              >
                Share invite link
              </button>
              {shareNote && <p className="mt-2 text-[11px] text-gray-500">{shareNote}</p>}

              {/* Owner-only reset — invalidates the current QR everywhere. */}
              {isOwner && (
                confirmingReset ? (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <p className="text-[11px] text-gray-500">
                      Reset the link? Any QR or link already shared will stop working.
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmingReset(false)}
                        disabled={resetting}
                        className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-medium text-gray-700 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void resetLink()}
                        disabled={resetting}
                        className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {resetting ? "Resetting…" : "Reset link"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingReset(true)}
                    className="mt-3 text-[11px] font-medium text-gray-400 hover:text-red-600"
                  >
                    Reset link
                  </button>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
