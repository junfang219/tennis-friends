"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Avatar from "@/components/Avatar";

type FriendEntry = {
  friendshipId: string;
  user: { id: string; name: string; profileImageUrl: string; skillLevel: string };
};

type GroupMember = {
  id: string;
  user: { id: string; name: string; profileImageUrl: string };
};

type Group = {
  id: string;
  name: string;
  ownerId: string;
  owner: { id: string; name: string; profileImageUrl: string };
  members: GroupMember[];
  _count: { members: number };
};

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [archivedGroups, setArchivedGroups] = useState<Group[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [swipedKey, setSwipedKey] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadGroups = () => {
    Promise.all([
      fetch("/api/groups").then((r) => r.json()),
      fetch("/api/groups?archived=true").then((r) => r.json()),
    ])
      .then(([active, arch]) => {
        setGroups(Array.isArray(active) ? active : []);
        setArchivedGroups(Array.isArray(arch) ? arch : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const archiveTeam = async (groupId: string) => {
    setSwipedKey(null);
    await fetch("/api/groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, action: "archive" }),
    });
    loadGroups();
  };

  const unarchiveTeam = async (groupId: string) => {
    setSwipedKey(null);
    await fetch("/api/groups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, action: "unarchive" }),
    });
    loadGroups();
  };

  useEffect(() => {
    loadGroups();
    fetch("/api/friends").then((r) => r.json()).then((data) => setFriends(data.friends || []));
  }, []);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-4">
              <div className="skeleton w-12 h-12 rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="skeleton w-36 h-4" />
                <div className="skeleton w-24 h-3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        <h1 className="font-display text-2xl font-bold text-court-green mb-1">
          Your Teams
        </h1>
        <p className="text-gray-500 text-sm mb-6">Organize your tennis circles</p>
      </div>

      <div className="space-y-4">
        {/* Create group button */}
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="w-full bg-white rounded-2xl shadow-sm border-2 border-dashed border-court-green-pale/40 p-5 flex items-center justify-center gap-3 text-court-green-soft hover:border-court-green-soft hover:bg-court-green-soft/5 transition-all group animate-fade-in-up stagger-1"
          >
            <div className="w-10 h-10 rounded-full bg-court-green-soft/10 flex items-center justify-center group-hover:bg-court-green-soft/20 transition-colors">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </div>
            <span className="font-semibold text-sm">Create a New Team</span>
          </button>
        )}

        {/* Create group form */}
        {showCreate && (
          <CreateGroupForm
            friends={friends}
            onCreated={() => { setShowCreate(false); loadGroups(); }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {/* Groups list */}
        {!showCreate && groups.length === 0 && (
          <div className="animate-fade-in-up stagger-2 text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
            <div className="w-14 h-14 bg-ball-yellow/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
              </svg>
            </div>
            <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No teams yet</h3>
            <p className="text-gray-500 text-sm">Create a team to organize your tennis friends!</p>
          </div>
        )}

        {!showCreate && groups.length > 0 && (
          <p className="text-xs text-gray-400 px-1">
            Tip: swipe left on a team to archive it.
          </p>
        )}

        {!showCreate && groups.map((group) => (
          <SwipeTeamRow
            key={group.id}
            rowKey={group.id}
            swipedKey={swipedKey}
            setSwipedKey={setSwipedKey}
            onTap={() => router.push(`/groups/${group.id}`)}
            actionLabel="Archive"
            actionColor="bg-amber-500"
            onAction={() => archiveTeam(group.id)}
            actionIcon={
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="21 8 21 21 3 21 3 8" />
                <rect x="1" y="3" width="22" height="5" />
                <line x1="10" y1="12" x2="14" y2="12" />
              </svg>
            }
          >
            <TeamCardBody group={group} />
          </SwipeTeamRow>
        ))}

        {/* Archived Teams collapsible */}
        {!showCreate && archivedGroups.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="21 8 21 21 3 21 3 8" />
                    <rect x="1" y="3" width="22" height="5" />
                    <line x1="10" y1="12" x2="14" y2="12" />
                  </svg>
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-800">Archived Teams</p>
                  <p className="text-xs text-gray-400">
                    {archivedGroups.length} team{archivedGroups.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${showArchived ? "rotate-180" : ""}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showArchived && (
              <div className="border-t border-gray-100 p-3 space-y-3 bg-gray-50/50">
                {archivedGroups.map((group) => (
                  <SwipeTeamRow
                    key={group.id}
                    rowKey={`arch-${group.id}`}
                    swipedKey={swipedKey}
                    setSwipedKey={setSwipedKey}
                    onTap={() => router.push(`/groups/${group.id}`)}
                    actionLabel="Unarchive"
                    actionColor="bg-court-green"
                    onAction={() => unarchiveTeam(group.id)}
                    actionIcon={
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 8 3 21 21 21 21 8" />
                        <rect x="1" y="3" width="22" height="5" />
                        <path d="M12 18V11" />
                        <polyline points="9 14 12 11 15 14" />
                      </svg>
                    }
                  >
                    <TeamCardBody group={group} />
                  </SwipeTeamRow>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── Team card body (shared between active and archived lists) ───────── */
function TeamCardBody({ group }: { group: Group }) {
  return (
    <div className="bg-white p-5 pb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-sm shadow-md">
            {group.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm truncate">{group.name}</h3>
            <p className="text-xs text-gray-400">
              {group._count.members} {group._count.members === 1 ? "member" : "members"}
            </p>
            <p className="text-[11px] text-court-green-soft font-medium mt-0.5 inline-flex items-center gap-1">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-ball-yellow drop-shadow-sm">
                <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" stroke="currentColor" strokeWidth="0.5" strokeLinejoin="round" />
              </svg>
              Captain · {group.owner.name}
            </p>
          </div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-300 shrink-0">
          <polyline points="9,18 15,12 9,6" />
        </svg>
      </div>
      <div className="flex items-center -space-x-2">
        {group.members.slice(0, 8).map((member) => {
          const isCaptain = member.user.id === group.ownerId;
          return (
            <div key={member.id} title={isCaptain ? `${member.user.name} (Captain)` : member.user.name} className="relative">
              <Avatar name={member.user.name} image={member.user.profileImageUrl} size="sm" />
              {isCaptain && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-ball-yellow flex items-center justify-center ring-2 ring-white shadow-sm">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-court-green">
                    <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
                  </svg>
                </span>
              )}
            </div>
          );
        })}
        {group.members.length > 8 && (
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-500 ring-2 ring-white">
            +{group.members.length - 8}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── SwipeTeamRow ───────── */
function SwipeTeamRow({
  rowKey,
  swipedKey,
  setSwipedKey,
  onTap,
  actionLabel,
  actionColor,
  actionIcon,
  onAction,
  children,
}: {
  rowKey: string;
  swipedKey: string | null;
  setSwipedKey: (k: string | null) => void;
  onTap: () => void;
  actionLabel: string;
  actionColor: string;
  actionIcon: React.ReactNode;
  onAction: () => void;
  children: React.ReactNode;
}) {
  const ACTION_WIDTH = 96;
  const OPEN_THRESHOLD = 50;
  const swiped = swipedKey === rowKey;

  const [dragX, setDragX] = useState(0);
  const startXRef = useRef<number | null>(null);
  const startOffsetRef = useRef(0);
  const currentDragRef = useRef(0);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const handleStart = (clientX: number) => {
    startXRef.current = clientX;
    startOffsetRef.current = swiped ? -ACTION_WIDTH : 0;
    currentDragRef.current = startOffsetRef.current;
    draggingRef.current = true;
    movedRef.current = false;
  };
  const handleMove = (clientX: number) => {
    if (!draggingRef.current || startXRef.current === null) return;
    const delta = clientX - startXRef.current;
    if (Math.abs(delta) > 5) movedRef.current = true;
    const next = Math.max(-ACTION_WIDTH, Math.min(0, startOffsetRef.current + delta));
    currentDragRef.current = next;
    setDragX(next);
  };
  const handleEnd = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const finalDrag = currentDragRef.current;
    const wasSwiped = swiped;
    const moved = movedRef.current;
    startXRef.current = null;

    if (moved) {
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 350);
    }

    if (!moved) return;

    if (wasSwiped) {
      if (finalDrag > -ACTION_WIDTH + OPEN_THRESHOLD) {
        setDragX(0);
        setSwipedKey(null);
      } else {
        setDragX(-ACTION_WIDTH);
      }
    } else {
      if (finalDrag < -OPEN_THRESHOLD) {
        setDragX(-ACTION_WIDTH);
        setSwipedKey(rowKey);
      } else {
        setDragX(0);
      }
    }
  };

  useEffect(() => {
    if (swiped) setDragX(-ACTION_WIDTH);
    else setDragX(0);
  }, [swiped]);

  const offset = draggingRef.current ? dragX : swiped ? -ACTION_WIDTH : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl shadow-sm border border-court-green-pale/20 bg-white">
      {/* Action button revealed by swipe */}
      <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: ACTION_WIDTH }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAction(); }}
          style={{ width: ACTION_WIDTH }}
          className={`${actionColor} text-white text-[11px] font-semibold flex flex-col items-center justify-center gap-1`}
        >
          {actionIcon}
          {actionLabel}
        </button>
      </div>

      {/* Sliding card content */}
      <div
        className="relative bg-white"
        style={{
          transform: `translateX(${offset}px)`,
          transition: draggingRef.current ? "none" : "transform 0.25s ease-out",
          touchAction: "pan-y",
        }}
        onTouchStart={(e) => handleStart(e.touches[0].clientX)}
        onTouchMove={(e) => handleMove(e.touches[0].clientX)}
        onTouchEnd={handleEnd}
        onTouchCancel={handleEnd}
        onMouseDown={(e) => { handleStart(e.clientX); }}
        onMouseMove={(e) => { if (draggingRef.current) handleMove(e.clientX); }}
        onMouseUp={handleEnd}
      >
        <button
          type="button"
          onClick={(e) => {
            if (suppressClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            if (swiped) {
              setSwipedKey(null);
              return;
            }
            onTap();
          }}
          className="w-full text-left card-hover"
        >
          {children}
        </button>
      </div>
    </div>
  );
}

/* ───────── Create Group Form ───────── */

function CreateGroupForm({ friends, onCreated, onCancel }: { friends: FriendEntry[]; onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), memberIds: Array.from(selectedIds) }) });
      if (!res.ok) { setCreating(false); return; }
      setCreating(false);
      onCreated();
    } catch { setCreating(false); }
  };

  const filteredFriends = friends.filter((f) =>
    f.user.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 animate-fade-in-up">
      <h3 className="font-display text-lg font-bold text-gray-800 mb-4">Create Team</h3>
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Team Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm" placeholder="e.g. Saturday Doubles Crew" autoFocus />
      </div>
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Select Friends ({selectedIds.size} selected)</label>
        {friends.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No friends to add yet. You can still create the team and add members later.</p>
        ) : (
          <>
            <div className="relative mb-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search friends..."
                className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-500"
                  aria-label="Clear search"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl border border-gray-100 p-2">
              {filteredFriends.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No matches for &quot;{search}&quot;</p>
              ) : (
                filteredFriends.map((f) => (
                  <label key={f.user.id} className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${selectedIds.has(f.user.id) ? "bg-court-green-soft/10 ring-1 ring-court-green-soft/30" : "hover:bg-gray-50"}`}>
                    <input type="checkbox" checked={selectedIds.has(f.user.id)} onChange={() => toggle(f.user.id)} className="sr-only" />
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${selectedIds.has(f.user.id) ? "bg-court-green border-court-green" : "border-gray-300"}`}>
                      {selectedIds.has(f.user.id) && (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>)}
                    </div>
                    <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                    <span className="text-sm font-medium text-gray-800">{f.user.name}</span>
                  </label>
                ))
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleCreate} disabled={!name.trim() || creating} className="btn-primary">{creating ? "Creating..." : "Create Team"}</button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

