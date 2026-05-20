"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { isAtLeast, ROLE } from "@/lib/groupRoles";

type Album = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  createdBy: { id: string; name: string; profileImageUrl: string };
  itemCount: number;
  cover: { id: string; url: string; mediaType: string } | null;
};

type Member = { userId: string; role: string };

type Group = {
  id: string;
  name: string;
  ownerId: string;
  members: Member[];
};

export default function AlbumsListPage() {
  const params = useParams();
  const { data: session } = useSession();
  const groupId = params.id as string;

  const [group, setGroup] = useState<Group | null>(null);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");

  const loadAlbums = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}/albums`);
    if (res.ok) setAlbums(await res.json());
  }, [groupId]);

  const loadGroup = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}`);
    if (res.ok) setGroup(await res.json());
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadGroup();
    void loadAlbums();
  }, [loadGroup, loadAlbums]);

  const myRole = group && session?.user?.id
    ? group.members.find((m) => m.userId === session.user!.id)?.role ?? null
    : null;
  const canCreate = !!myRole && isAtLeast(myRole, ROLE.CAPTAIN);

  const createAlbum = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setErr("");
    const res = await fetch(`/api/groups/${groupId}/albums`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDescription.trim() }),
    });
    if (res.ok) {
      setNewName("");
      setNewDescription("");
      setShowCreate(false);
      await loadAlbums();
    } else {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Failed to create album.");
    }
    setCreating(false);
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton w-full h-12 rounded-xl mb-4" />
        <div className="grid grid-cols-2 gap-3">
          <div className="skeleton w-full aspect-square rounded-2xl" />
          <div className="skeleton w-full aspect-square rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">Team not found or you&apos;re not a member.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/groups/${groupId}`}
          className="w-9 h-9 rounded-full bg-white shadow-sm border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-gray-600"
          aria-label="Back to team"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-gray-900 truncate">{group.name}</h1>
          <p className="text-xs text-gray-500">Albums</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowCreate((v) => !v)} className="btn-primary px-3 py-1.5 text-xs">
            {showCreate ? "Cancel" : "+ New album"}
          </button>
        )}
      </div>

      {showCreate && canCreate && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Album name (e.g. Summer 2026 Tournament)"
            maxLength={80}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
          />
          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            maxLength={500}
            rows={2}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green resize-none"
          />
          <button onClick={createAlbum} disabled={creating || !newName.trim()} className="btn-primary w-full">
            {creating ? "Creating..." : "Create album"}
          </button>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}

      {albums.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-court-green-pale/30 flex items-center justify-center text-court-green">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-gray-700">No albums yet</p>
          <p className="text-xs text-gray-400 mt-1">
            {canCreate ? "Create one to share photos and videos with your team." : "Ask a captain to create one."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {albums.map((a) => (
            <Link
              key={a.id}
              href={`/groups/${groupId}/albums/${a.id}`}
              className="block group bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="aspect-square bg-gradient-to-br from-court-green-pale/30 to-ball-yellow/15 relative">
                {a.cover ? (
                  a.cover.mediaType === "video" ? (
                    <video
                      src={`${a.cover.url}#t=0.1`}
                      preload="metadata"
                      playsInline
                      muted
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.cover.url} alt={a.name} className="absolute inset-0 w-full h-full object-cover" />
                  )
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                )}
                <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-bold">
                  {a.itemCount}
                </span>
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold text-gray-800 truncate">{a.name}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">by {a.createdBy.name}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
