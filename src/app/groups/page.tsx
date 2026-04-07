"use client";

import { useEffect, useState } from "react";
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);

  const loadGroups = () => {
    fetch("/api/groups").then((r) => r.json()).then((data) => {
      setGroups(Array.isArray(data) ? data : []);
      setLoading(false);
    });
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
        {!showCreate && !editingGroup && (
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

        {/* Edit group form */}
        {editingGroup && (
          <EditGroupForm
            group={editingGroup}
            friends={friends}
            onUpdated={() => { setEditingGroup(null); loadGroups(); }}
            onCancel={() => setEditingGroup(null)}
          />
        )}

        {/* Groups list */}
        {!showCreate && !editingGroup && groups.length === 0 && (
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

        {!showCreate && !editingGroup && groups.map((group, i) => (
          <div
            key={group.id}
            className={`animate-fade-in-up stagger-${Math.min(i + 2, 5)} bg-white rounded-2xl shadow-sm border border-court-green-pale/20 overflow-hidden card-hover`}
          >
            <Link href={`/groups/${group.id}`} className="block p-5 pb-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-sm shadow-md">
                    {group.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 text-sm">{group.name}</h3>
                    <p className="text-xs text-gray-400">{group._count.members} {group._count.members === 1 ? "member" : "members"}</p>
                  </div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-gray-300">
                  <polyline points="9,18 15,12 9,6" />
                </svg>
              </div>
              <div className="flex items-center -space-x-2">
                {group.members.slice(0, 8).map((member) => (
                  <div key={member.id} title={member.user.name}>
                    <Avatar name={member.user.name} image={member.user.profileImageUrl} size="sm" />
                  </div>
                ))}
                {group.members.length > 8 && (
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-500 ring-2 ring-white">
                    +{group.members.length - 8}
                  </div>
                )}
              </div>
            </Link>
            <div className="px-5 pb-3 flex items-center justify-end border-t border-gray-50 pt-2">
              <button
                onClick={(e) => { e.preventDefault(); setEditingGroup(group); }}
                className="text-xs text-gray-400 hover:text-court-green transition-colors px-2 py-1 rounded-lg hover:bg-gray-50 flex items-center gap-1"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── Create Group Form ───────── */

function CreateGroupForm({ friends, onCreated, onCancel }: { friends: FriendEntry[]; onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);

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
          <p className="text-sm text-gray-400 py-4 text-center">No friends to add yet. You can still create the group and add members later.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl border border-gray-100 p-2">
            {friends.map((f) => (
              <label key={f.user.id} className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all ${selectedIds.has(f.user.id) ? "bg-court-green-soft/10 ring-1 ring-court-green-soft/30" : "hover:bg-gray-50"}`}>
                <input type="checkbox" checked={selectedIds.has(f.user.id)} onChange={() => toggle(f.user.id)} className="sr-only" />
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${selectedIds.has(f.user.id) ? "bg-court-green border-court-green" : "border-gray-300"}`}>
                  {selectedIds.has(f.user.id) && (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>)}
                </div>
                <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                <span className="text-sm font-medium text-gray-800">{f.user.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={handleCreate} disabled={!name.trim() || creating} className="btn-primary">{creating ? "Creating..." : "Create Team"}</button>
        <button onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

/* ───────── Edit Group Form ───────── */

function EditGroupForm({ group, friends, onUpdated, onCancel }: { group: Group; friends: FriendEntry[]; onUpdated: () => void; onCancel: () => void }) {
  const [name, setName] = useState(group.name);
  const currentMemberIds = new Set(group.members.map((m) => m.user.id));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(currentMemberIds));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = (id: string) => { if (id === group.ownerId) return; const next = new Set(selectedIds); if (next.has(id)) next.delete(id); else next.add(id); setSelectedIds(next); };

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const addMemberIds = Array.from(selectedIds).filter((id) => !currentMemberIds.has(id));
    const removeMemberIds = Array.from(currentMemberIds).filter((id) => !selectedIds.has(id));
    await fetch("/api/groups", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: group.id, name: name !== group.name ? name : undefined, addMemberIds: addMemberIds.length ? addMemberIds : undefined, removeMemberIds: removeMemberIds.length ? removeMemberIds : undefined }) });
    setSaving(false);
    onUpdated();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await fetch("/api/groups", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: group.id }) });
    setDeleting(false);
    onUpdated();
  };

  const allPeople = new Map<string, { id: string; name: string; profileImageUrl: string }>();
  friends.forEach((f) => allPeople.set(f.user.id, f.user));
  group.members.forEach((m) => allPeople.set(m.user.id, m.user));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 animate-fade-in-up">
      <h3 className="font-display text-lg font-bold text-gray-800 mb-4">Edit Team</h3>
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Team Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm" autoFocus />
      </div>
      <div className="mb-4">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Members ({selectedIds.size})</label>
        <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl border border-gray-100 p-2">
          {Array.from(allPeople.values()).map((person) => {
            const isOwner = person.id === group.ownerId;
            return (
              <label key={person.id} className={`flex items-center gap-3 p-2.5 rounded-xl transition-all ${isOwner ? "opacity-70 cursor-default" : "cursor-pointer"} ${selectedIds.has(person.id) ? "bg-court-green-soft/10 ring-1 ring-court-green-soft/30" : "hover:bg-gray-50"}`}>
                <input type="checkbox" checked={selectedIds.has(person.id)} onChange={() => toggle(person.id)} disabled={isOwner} className="sr-only" />
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${selectedIds.has(person.id) ? "bg-court-green border-court-green" : "border-gray-300"}`}>
                  {selectedIds.has(person.id) && (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><polyline points="20,6 9,17 4,12" /></svg>)}
                </div>
                <Avatar name={person.name} image={person.profileImageUrl} size="sm" />
                <span className="text-sm font-medium text-gray-800 flex-1">{person.name}</span>
                {isOwner && (<span className="text-xs text-court-green-soft bg-court-green-soft/10 px-2 py-0.5 rounded-full font-medium">Owner</span>)}
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={!name.trim() || saving} className="btn-primary">{saving ? "Saving..." : "Save Changes"}</button>
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
        </div>
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="text-xs text-gray-400 hover:text-red-500 transition-colors px-2 py-1">Delete Team</button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-red-500">Sure?</span>
            <button onClick={handleDelete} disabled={deleting} className="btn-danger btn-sm">{deleting ? "..." : "Delete"}</button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">No</button>
          </div>
        )}
      </div>
    </div>
  );
}
