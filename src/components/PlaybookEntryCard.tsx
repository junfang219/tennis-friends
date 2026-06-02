"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { deletePost, updatePlaybookEntry } from "@/lib/supabase/queries";
import { toPostCamel, type PostCamel } from "@/lib/supabase/adapters";
import { errorMessage } from "@/lib/errorMessage";

interface Props {
  entry: PostCamel;
  isOwner: boolean;
  onEdit?: (entry: PostCamel) => void;
  onChanged: (entry: PostCamel) => void;
  onDeleted: (id: string) => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const day = 24 * 60 * 60 * 1000;
  if (diffMs < day && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  if (diffMs < 7 * day) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function PlaybookEntryCard({
  entry,
  isOwner,
  onEdit,
  onChanged,
  onDeleted,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const isPrivate = entry.visibility === "private";
  const isPinned = !!entry.pinnedAt;

  const togglePin = async () => {
    setMenuOpen(false);
    setBusy(true);
    setErr("");
    try {
      const supabase = createSupabaseBrowserClient();
      const row = await updatePlaybookEntry(supabase, entry.id, {
        pinned_at: isPinned ? null : new Date().toISOString(),
      });
      onChanged(toPostCamel(row));
    } catch (e) {
      setErr(errorMessage(e, "Could not update pin"));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!confirm("Delete this entry? This can't be undone.")) return;
    setBusy(true);
    setErr("");
    try {
      const supabase = createSupabaseBrowserClient();
      await deletePost(supabase, entry.id);
      onDeleted(entry.id);
    } catch (e) {
      setErr(errorMessage(e, "Could not delete entry"));
      setBusy(false);
    }
  };

  const media = entry.media ?? [];

  return (
    <article className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden">
      {/* Header: badges + kebab */}
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium ${
              isPrivate
                ? "bg-gray-100 text-gray-600"
                : "bg-court-green-pale/40 text-court-green"
            }`}
          >
            {isPrivate ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 1 1 8 0v3" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
                <circle cx="10" cy="7" r="4" />
              </svg>
            )}
            {isPrivate ? "Private" : "Friends"}
          </span>
          {isPinned && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ball-yellow/30 text-yellow-800 font-medium">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 3l5 5-7 7v6l-3-3-3 3v-6L1 8l5-5h10z" />
              </svg>
              Pinned
            </span>
          )}
          <span className="text-gray-400">{formatWhen(entry.createdAt)}</span>
        </div>
        {isOwner && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              disabled={busy}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              aria-label="Entry options"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-xl shadow-lg border border-gray-100 z-10 overflow-hidden">
                <button
                  onClick={togglePin}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M16 3l5 5-7 7v6l-3-3-3 3v-6L1 8l5-5h10z" />
                  </svg>
                  {isPinned ? "Unpin" : "Pin"}
                </button>
                {onEdit && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit(entry);
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-2"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                    </svg>
                    Edit
                  </button>
                )}
                <button
                  onClick={handleDelete}
                  className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      {entry.content && (
        <div className="px-4 pt-2 pb-3">
          <p className="text-[15px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
            {entry.content}
          </p>
        </div>
      )}

      {/* Media */}
      {media.length > 0 && (
        <div
          className={
            media.length === 1
              ? "px-4 pb-4"
              : "grid grid-cols-3 gap-1 px-4 pb-4"
          }
        >
          {media.map((m) =>
            m.kind === "image" ? (
              <img
                key={m.id}
                src={m.url}
                alt=""
                loading="lazy"
                className={
                  media.length === 1
                    ? "w-full max-h-[420px] object-cover rounded-xl bg-gray-100"
                    : "aspect-square w-full object-cover rounded-md bg-gray-100"
                }
              />
            ) : (
              <video
                key={m.id}
                src={m.url}
                controls
                playsInline
                preload="metadata"
                poster={m.thumbnailUrl || undefined}
                className={
                  media.length === 1
                    ? "w-full max-h-[420px] object-cover rounded-xl bg-black"
                    : "aspect-square w-full object-cover rounded-md bg-black"
                }
              />
            ),
          )}
        </div>
      )}

      {err && <p className="px-4 pb-3 text-sm text-red-600">{err}</p>}
    </article>
  );
}
