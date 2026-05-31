"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { canCaptain, type TeamRole } from "@/lib/groupRoles";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getGroup, listGroupMembers } from "@/lib/supabase/queries";
import { uploadToBucket, isUploadError } from "@/lib/supabase/upload";
import { publicStorageThumbUrl } from "@/lib/supabase/storage";

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

type Member = { userId: string; roles: TeamRole[] };

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
  // Lightbox state — index of the currently-open item, null when closed.
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAlbum = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase
      .from("albums")
      .select(
        `id, name, description, created_at, created_by_id, cover_item_id,
         createdBy:profiles!albums_created_by_id_fkey ( id, name, profile_image_url ),
         items:album_items!album_items_album_id_fkey ( id, url, media_type, caption, created_at,
           addedBy:profiles!album_items_added_by_id_fkey ( id, name, profile_image_url )
         )`
      )
      .eq("id", albumId)
      .maybeSingle();
    if (error || !data) {
      setErr("Album not found.");
      setLoading(false);
      return;
    }
    type Row = {
      id: string;
      name: string;
      description: string;
      created_at: string;
      created_by_id: string;
      cover_item_id: string | null;
      createdBy: { id: string; name: string; profile_image_url: string };
      items: {
        id: string;
        url: string;
        media_type: string;
        caption: string;
        created_at: string;
        addedBy: { id: string; name: string; profile_image_url: string };
      }[];
    };
    const a = data as unknown as Row;
    setAlbum({
      id: a.id,
      name: a.name,
      description: a.description,
      createdAt: a.created_at,
      createdById: a.created_by_id,
      coverItemId: a.cover_item_id,
      createdBy: {
        id: a.createdBy.id,
        name: a.createdBy.name,
        profileImageUrl: a.createdBy.profile_image_url,
      },
      items: a.items
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((it) => ({
          id: it.id,
          url: it.url,
          mediaType: it.media_type,
          caption: it.caption,
          createdAt: it.created_at,
          addedBy: {
            id: it.addedBy.id,
            name: it.addedBy.name,
            profileImageUrl: it.addedBy.profile_image_url,
          },
        })),
    } as unknown as typeof album);
    setLoading(false);
  }, [albumId]);

  const loadGroup = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const [g, members] = await Promise.all([
      getGroup(supabase, groupId),
      listGroupMembers(supabase, groupId),
    ]);
    if (g) {
      setGroup({
        id: g.id,
        name: g.name,
        ownerId: g.owner_id,
        members: members.map((m) => ({ userId: m.user_id, roles: m.roles })),
      } as unknown as typeof group);
    }
  }, [groupId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAlbum();
    void loadGroup();
  }, [loadAlbum, loadGroup]);

  const myId = session?.user?.id || "";
  const me = group?.members.find((m) => m.userId === myId);
  const isMember = !!me;
  const isOwner = !!myId && group?.ownerId === myId;
  const isCaptainOrAbove = canCaptain({ isOwner, roles: me?.roles ?? [] });
  const isAlbumCreator = !!album && album.createdById === myId;
  const canDeleteAlbum = isCaptainOrAbove || isAlbumCreator;

  const onFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploadError("");
    setUploading(true);

    const supabase = createSupabaseBrowserClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setUploadError("Not signed in.");
      setUploading(false);
      return;
    }
    const newItems: { url: string; mediaType: string }[] = [];
    for (const file of files) {
      const upResult = await uploadToBucket(file, "albums");
      if (isUploadError(upResult)) {
        setUploadError(upResult.message || `Upload of ${file.name} failed.`);
        continue;
      }
      newItems.push({ url: upResult.url, mediaType: upResult.mediaType });
    }

    if (newItems.length > 0) {
      const rows = newItems.map((it) => ({
        album_id: albumId,
        url: it.url,
        media_type: it.mediaType,
        added_by_id: auth.user!.id,
      }));
      const { error: insErr } = await supabase.from("album_items").insert(rows);
      if (!insErr) {
        await loadAlbum();
      } else {
        setUploadError(insErr.message || "Failed to add items.");
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const deleteItem = async (itemId: string) => {
    if (!confirm("Remove this item from the album?")) return;
    const supabase = createSupabaseBrowserClient();
    const { error: delErr } = await supabase
      .from("album_items")
      .delete()
      .eq("id", itemId);
    if (!delErr) await loadAlbum();
    else alert(delErr.message || "Failed to remove item.");
  };

  const deleteAlbum = async () => {
    if (!confirm("Delete this album and all its items? This can't be undone.")) return;
    const supabase = createSupabaseBrowserClient();
    const { error: delErr } = await supabase.from("albums").delete().eq("id", albumId);
    if (!delErr) router.push(`/groups/${groupId}/albums`);
    else alert(delErr.message || "Failed to delete album.");
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
      {isMember && (
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
          {album.items.map((it, i) => {
            const canRemove = it.addedById === myId || isCaptainOrAbove;
            return (
              <div key={it.id} className="relative group rounded-lg overflow-hidden bg-gray-100 aspect-square">
                <button
                  type="button"
                  onClick={() => setOpenIndex(i)}
                  className="block w-full h-full"
                  aria-label={`Open ${it.caption || (it.mediaType === "video" ? "video" : "photo")}`}
                >
                  {it.mediaType === "video" ? (
                    <>
                      <video
                        src={`${it.url}#t=0.1`}
                        preload="metadata"
                        playsInline
                        muted
                        className="w-full h-full object-cover pointer-events-none"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                        <span className="w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center shadow-lg">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="8,5 19,12 8,19" />
                          </svg>
                        </span>
                      </span>
                    </>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={publicStorageThumbUrl(it.url, { width: 300, height: 300 })}
                      alt={it.caption || ""}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  )}
                </button>
                {canRemove && (
                  <button
                    onClick={() => deleteItem(it.id)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
                    aria-label="Remove item"
                    title="Remove"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
                <div className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/50 backdrop-blur px-1 py-0.5 rounded-full pointer-events-none">
                  <Avatar name={it.addedBy.name} image={it.addedBy.profileImageUrl} size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {openIndex !== null && album.items[openIndex] && (
        <Lightbox
          items={album.items}
          index={openIndex}
          onClose={() => setOpenIndex(null)}
          onNavigate={(i) => setOpenIndex(i)}
        />
      )}
    </div>
  );
}

/* ────── Lightbox ────── */

// Derive a friendly filename for the browser's "Save as" dialog. Falls back
// to the URL's basename when there's no caption to work with.
function downloadName(item: Item): string {
  const url = item.url;
  const urlExt = (url.split(".").pop() || "").toLowerCase();
  const ext = /^[a-z0-9]{2,5}$/.test(urlExt)
    ? urlExt
    : item.mediaType === "video" ? "mp4" : "jpg";
  const base = (item.caption || "").trim();
  if (base) {
    const safe = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    if (safe) return `${safe}.${ext}`;
  }
  return url.split("/").pop() || `download.${ext}`;
}

function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: Item[];
  index: number;
  onClose: () => void;
  onNavigate: (next: number) => void;
}) {
  const item = items[index];
  const canPrev = index > 0;
  const canNext = index < items.length - 1;

  // Keyboard nav: Esc closes, arrows move. Also lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && canPrev) onNavigate(index - 1);
      else if (e.key === "ArrowRight" && canNext) onNavigate(index + 1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, canPrev, canNext, onClose, onNavigate]);

  if (!item) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Top-right actions: download + close. Top offset respects the iOS
          status-bar / Dynamic Island via env(safe-area-inset-top). */}
      <div
        className="absolute right-4 flex items-center gap-2 z-10"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <a
          href={item.url}
          download={downloadName(item)}
          // target=_self stops Safari from opening the URL in a new tab when
          // the server doesn't send Content-Disposition: attachment.
          target="_self"
          rel="noopener"
          className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
          aria-label="Download"
          title="Download"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </a>
        <button
          type="button"
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Counter — matches the toolbar's safe-area offset on the left. */}
      <div
        className="absolute left-4 text-white/80 text-sm font-medium z-10 bg-black/40 backdrop-blur px-3 py-1 rounded-full"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}
      >
        {index + 1} / {items.length}
      </div>

      {/* Prev */}
      {canPrev && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
          className="absolute left-2 sm:left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center z-10"
          aria-label="Previous"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}

      {/* Next */}
      {canNext && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
          className="absolute right-2 sm:right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center z-10"
          aria-label="Next"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}

      {/* Media — clicks inside don't close */}
      <div
        className="max-w-[95vw] max-h-[85vh] flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        {item.mediaType === "video" ? (
          <video
            key={item.id}
            src={item.url}
            controls
            autoPlay
            playsInline
            className="max-w-[95vw] max-h-[78vh] rounded-lg shadow-2xl"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.id}
            src={item.url}
            alt={item.caption || ""}
            className="max-w-[95vw] max-h-[78vh] object-contain rounded-lg shadow-2xl"
          />
        )}

        {/* Footer: caption + uploader */}
        <div className="mt-3 text-center text-white/90 max-w-[95vw]">
          {item.caption && <p className="text-sm mb-1">{item.caption}</p>}
          <p className="text-xs text-white/60">Added by {item.addedBy.name}</p>
        </div>
      </div>
    </div>
  );
}
