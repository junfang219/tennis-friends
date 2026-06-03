"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession, signOut } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getMyProfile, updateMyProfile } from "@/lib/supabase/queries";
import { getCurrentPosition, isPositionError } from "@/lib/getCurrentPosition";
import { useCachedQuery } from "@/lib/useCachedQuery";
import Avatar from "@/components/Avatar";

const SETTINGS_CACHE_KEY = "settings:profile";

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  // Lightweight profile fetch — just the fields these controls own
  // (is_private, latitude, longitude). Kept on its own cache key so it
  // doesn't collide with the profile page's heavier "profile:me" shape.
  const profileQuery = useCachedQuery(
    status === "authenticated" ? SETTINGS_CACHE_KEY : null,
    () => getMyProfile(createSupabaseBrowserClient()),
  );
  const profile = profileQuery.data;

  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyError, setPrivacyError] = useState("");
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [confirmingTurnOff, setConfirmingTurnOff] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const deleteAccount = async () => {
    setDeleteError("");
    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "" }));
        setDeleteError(body.error || "Could not delete account. Try again.");
        setDeleting(false);
        return;
      }
      // Don't reset `deleting` — keep the button disabled while signOut
      // tears the page down so the user can't double-submit.
      await signOut({ callbackUrl: "/login?deleted=1" });
    } catch {
      setDeleteError("Network error. Try again.");
      setDeleting(false);
    }
  };

  // Bounce unauthenticated visitors to login (mirrors the profile page).
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [status, router]);

  const togglePrivacy = async (next: boolean) => {
    if (!profile) return;
    setPrivacyError("");
    setPrivacySaving(true);
    // Optimistic: flip the cached value immediately.
    profileQuery.mutate((p) => (p ? { ...p, is_private: next } : null));
    try {
      const supabase = createSupabaseBrowserClient();
      await updateMyProfile(supabase, { is_private: next });
    } catch {
      profileQuery.mutate((p) => (p ? { ...p, is_private: !next } : null));
      setPrivacyError("Could not update privacy. Try again.");
    }
    setPrivacySaving(false);
  };

  const turnOnLocation = async () => {
    setLocationError("");
    setLocationSaving(true);
    const pos = await getCurrentPosition();
    if (isPositionError(pos)) {
      setLocationSaving(false);
      setLocationError(
        pos.code === "permission_denied" ? "Location permission denied." :
        pos.code === "unsupported" ? "Your browser doesn't support geolocation." :
        "Could not get your location."
      );
      return;
    }
    try {
      const supabase = createSupabaseBrowserClient();
      await updateMyProfile(supabase, { latitude: pos.latitude, longitude: pos.longitude });
      profileQuery.mutate((p) => (p ? { ...p, latitude: pos.latitude, longitude: pos.longitude } : null));
    } catch {
      setLocationError("Could not save location.");
    }
    setLocationSaving(false);
  };

  const turnOffLocation = async () => {
    setLocationError("");
    setLocationSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await updateMyProfile(supabase, { latitude: null, longitude: null });
      profileQuery.mutate((p) => (p ? { ...p, latitude: null, longitude: null } : null));
      setConfirmingTurnOff(false);
    } catch {
      setLocationError("Could not turn off location.");
    }
    setLocationSaving(false);
  };

  if (status !== "authenticated" || !session?.user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="skeleton w-32 h-7 mb-6 rounded" />
        <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
          <div className="skeleton w-full h-14 rounded" />
          <div className="skeleton w-full h-12 rounded" />
        </div>
      </div>
    );
  }

  const user = session.user;
  const isPrivate = profile?.is_private ?? false;
  const locationOn = profile?.latitude != null && profile?.longitude != null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/profile"
          aria-label="Back to profile"
          className="btn-secondary btn-sm"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1 className="font-display text-2xl font-bold text-court-green">Settings</h1>
      </div>

      {/* Account */}
      <section className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-2">
          Account
        </h2>
        <Link
          href="/profile"
          className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors"
        >
          <Avatar name={user.name || ""} image={user.image} size="md" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-gray-900 truncate">{user.name}</p>
            {user.email && (
              <p className="text-sm text-gray-500 truncate">{user.email}</p>
            )}
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      </section>

      {/* Privacy */}
      <section className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-2">
          Privacy
        </h2>
        <div className="flex items-start gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-800">Private account</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Only friends can see your posts. Your profile card and highlights stay visible to everyone. Posts you share to teams or as nearby broadcasts still reach their audience.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isPrivate}
            aria-label="Private account"
            disabled={!profile || privacySaving}
            onClick={() => togglePrivacy(!isPrivate)}
            className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              isPrivate ? "bg-court-green" : "bg-gray-300"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                isPrivate ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        {privacyError && (
          <p className="text-xs text-red-500 px-4 pb-3">{privacyError}</p>
        )}
      </section>

      {/* Location */}
      <section className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-4 pt-4 pb-2">
          Location <span className="font-normal normal-case tracking-normal text-gray-400">(used to match by distance for nearby broadcasts)</span>
        </h2>
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${locationOn ? "bg-court-green-pale/30 text-court-green" : "bg-gray-200 text-gray-500"}`}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800">
                Location sharing {locationOn ? "is on" : "is off"}
              </p>
              <p className="text-xs text-gray-500">
                {locationOn
                  ? "Players nearby can match with your broadcasts."
                  : "Turn on to see broadcasts and match by distance."}
              </p>
            </div>
            {locationOn ? (
              <button
                type="button"
                onClick={() => setConfirmingTurnOff(true)}
                disabled={!profile || locationSaving}
                className="btn-secondary btn-sm whitespace-nowrap disabled:opacity-60"
              >
                Turn off
              </button>
            ) : (
              <button
                type="button"
                onClick={turnOnLocation}
                disabled={!profile || locationSaving}
                className="btn-primary btn-sm whitespace-nowrap disabled:opacity-60"
              >
                {locationSaving ? "..." : "Turn on"}
              </button>
            )}
          </div>
          {locationError && (
            <p className="text-xs text-red-500 mt-2">{locationError}</p>
          )}
          {confirmingTurnOff && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-xs text-gray-600 mb-2">
                This will also turn off any active broadcasts you have. You can re-share later.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={turnOffLocation}
                  disabled={locationSaving}
                  className="btn-danger btn-sm disabled:opacity-60"
                >
                  {locationSaving ? "Turning off..." : "Turn off location"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingTurnOff(false)}
                  disabled={locationSaving}
                  className="btn-secondary btn-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Sign out */}
      <section className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden">
        <button
          onClick={() => {
            setSigningOut(true);
            signOut({ callbackUrl: "/login" });
          }}
          disabled={signingOut}
          className="w-full flex items-center gap-3 px-4 py-4 text-sm font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
            <polyline points="16,17 21,12 16,7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </section>

      {/* Danger zone */}
      <section className="bg-white rounded-2xl shadow-sm border border-red-200 overflow-hidden mt-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-red-600 px-4 pt-4 pb-2">
          Danger zone
        </h2>
        <div className="px-4 pb-4">
          <p className="text-xs text-gray-500 mb-3">
            Permanently delete your account and everything tied to it. This cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => {
              setDeleteConfirmInput("");
              setDeleteError("");
              setShowDeleteModal(true);
            }}
            className="btn-danger btn-sm"
          >
            Delete account
          </button>
        </div>
      </section>

      {showDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (!deleting) setShowDeleteModal(false);
            }}
            aria-hidden="true"
          />
          <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 mx-0 sm:mx-4">
            <h3 id="delete-account-title" className="text-lg font-semibold text-gray-900">
              Delete account?
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              This will permanently remove everything tied to your account:
            </p>
            <ul className="mt-2 text-sm text-gray-600 list-disc pl-5 space-y-0.5">
              <li>Your profile, avatar, and bio</li>
              <li>Posts, comments, likes, and photos/videos you uploaded</li>
              <li>Direct messages and group chats you created</li>
              <li>RSVPs, events you own, polls, and bookings</li>
              <li>Teams you own (other members will lose access)</li>
              <li>Friendships and push notifications</li>
            </ul>
            <p className="mt-3 text-sm font-semibold text-red-600">
              This cannot be undone.
            </p>
            <label className="block mt-4 text-xs text-gray-600">
              Type <span className="font-mono font-semibold">DELETE</span> to confirm
            </label>
            <input
              type="text"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              disabled={deleting}
              className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 disabled:bg-gray-50"
            />
            {deleteError && (
              <p className="mt-2 text-xs text-red-600">{deleteError}</p>
            )}
            <div className="mt-4 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteAccount}
                disabled={deleting || deleteConfirmInput !== "DELETE"}
                className="btn-danger btn-sm disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete account permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
