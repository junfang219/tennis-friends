"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { isAtLeast, ROLE } from "@/lib/groupRoles";

type Item = {
  id: string;
  url: string;
  mediaType: string;
  caption: string;
  createdAt: string;
  addedById: string;
  addedBy: { id: string; name: string; profileImageUrl: string };
};

type Album = {
  id: string;
  groupId: string;
  name: string;
  description: string;
  createdById: string;
  createdAt: string;
  createdBy: { id: string; name: string; profileImageUrl: string };
  items: Item[];
};

type Member = { userId: string; role: string };

type Group = {
  id: string;
  name: string;
  ownerId: string;
  members: Member[];
};

export default function AlbumDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const groupId = params.id as string;
  const albumId = params.albumId as string;

  const [album, setAlbum] = useState<Album | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAlbum = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}/albums/${albumId}`);
    if (res.status === 404) {
      setErr("Album not found.");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setErr("Failed to load album.");
      setLoading(false);
      return;
    }
    setAlbum(await res.json());
    setLoading(false);
  }, [groupId, albumId]);

  const loadGroup = useCallback(async () => {
    const res = await fetch(`/api/groups/${groupId}`);
    if (res.ok) setGroup(await res.json());
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAlbum();
    void loadGroup();
  }, [loadAlbum, loadGroup]);

  const myId = session?.user?.id || "";
  const myRole = group && myId
    ? group.members.find((m) => m.userId === myId)?.role ?? null
    : null;
  const isCaptainOrAbove = !!myRole && isAtLeast(myRole, ROLE.CAPTAIN);
  const isAlbumCreator = !!album && album.createdById === myId;
  const canDeleteAlbum = isCaptainOrAbove || isAlbumCreator;

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadError("");
    setUploading(true);

    const newItems: { url: string; mediaType: string }[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setUploadError(d.error || `Upload of ${file.name} failed.`);
        continue;
      }
      const data = await res.json();
      newItems.push({ url: data.url, mediaType: data.mediaType });
    }

    if (newItems.length > 0) {
      const res = await fetch(`/api/groups/${groupId}/albums/${albumId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: newItems }),
      });
      if (res.ok) {
        await loadAlbum();
      } else {
        const d = await res.json().catch(() => ({}));
        setUploadError(d.error || "Failed to add items.");
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const deleteItem = async (itemId: string) => {
    if (!confirm("Remove this item from the album?")) return;
    const res = await fetch(`/api/groups/${groupId}/albums/${albumId}/items/${itemId}`, {
      method: "DELETE",
    });
    if (res.ok) await loadAlbum();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to remove item.");
    }
  };

  const deleteAlbum = async () => {
    if (!confirm("Delete this album and all its items? This can't be undone.")) return;
    const res = await fetch(`/api/groups/${groupId}/albums/${albumId}`, { method: "DELETE" });
    if (res.ok) router.push(`/groups/${groupId}/albums`);
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Failed to delete album.");
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="skeleton w-full h-12 rounded-xl mb-4" />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton w-full aspect-square rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (err || !album) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">{err || "Album not found."}</p>
        <Link href={`/groups/${groupId}/albums`} className="btn-primary mt-4 inline-block">
          Back to albums
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href={`/groups/${groupId}/albums`}
          className="w-9 h-9 rounded-full bg-white shadow-sm border border-gray-200 hover:bg-gray-50 flex items-center justify-center text-gray-600"
          aria-label="Back to albums"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-xl font-bold text-gray-900 truncate">{album.name}</h1>
          <p className="text-xs text-gray-500">
            {album.items.length} {album.items.length === 1 ? "item" : "items"} · by {album.createdBy.name}
          </p>
        </div>
        {canDeleteAlbum && (
          <button onClick={deleteAlbum} className="text-xs font-semibold text-red-500 hover:text-red-600">
            Delete
          </button>
        )}
      </div>

      {album.description && (
        <p className="text-sm text-gray-600 mb-4">{album.description}</p>
      )}

      {/* Uploader (any member) */}
      {myRole && (
        <div className="mb-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime,video/mov"
            multiple
            onChange={onFilesSelected}
            disabled={uploading}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-secondary w-full"
          >
            {uploading ? "Uploading..." : "+ Add photos or videos"}
          </button>
          {uploadError && <p className="text-xs text-red-600 mt-2">{uploadError}</p>}
        </div>
      )}

      {album.items.length === 0 ? (
        <p className="text-center text-sm text-gray-400 py-12">
          No items yet. Be the first to add something.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {album.items.map((it) => {
            const canRemove = it.addedById === myId || isCaptainOrAbove;
            return (
              <div key={it.id} className="relative group rounded-lg overflow-hidden bg-gray-100 aspect-square">
                {it.mediaType === "video" ? (
                  <video src={`${it.url}#t=0.1`} controls preload="metadata" playsInline className="w-full h-full object-cover" />
                ) : (
                  <a href={it.url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={it.url} alt={it.caption || ""} className="w-full h-full object-cover" />
                  </a>
                )}
                {canRemove && (
                  <button
                    onClick={() => deleteItem(it.id)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    aria-label="Remove item"
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
                <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/50 backdrop-blur px-1 py-0.5 rounded-full">
                  <Avatar name={it.addedBy.name} image={it.addedBy.profileImageUrl} size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
