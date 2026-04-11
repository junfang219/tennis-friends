"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import Avatar from "@/components/Avatar";

type FriendUser = { id: string; name: string; profileImageUrl: string; skillLevel: string };

type FriendEntry = {
  friendshipId: string;
  user: FriendUser;
};

type FriendsData = {
  friends: FriendEntry[];
  incomingRequests: FriendEntry[];
  outgoingRequests: FriendEntry[];
};

type FriendGroup = {
  id: string;
  name: string;
  members: { user: { id: string; name: string; profileImageUrl: string } }[];
  _count: { members: number };
};

type BlockedEntry = {
  id: string;
  createdAt: string;
  user: { id: string; name: string; profileImageUrl: string; skillLevel: string };
};

type InboxItem = {
  type: "direct" | "group" | "team";
  id: string;
  title: string;
  href: string;
  unreadCount: number;
  muted: boolean;
  pinnedAt: string | null;
  // direct only
  avatarUser?: { id: string; name: string; profileImageUrl: string };
  // group / team
  participants?: { id: string; name: string; profileImageUrl: string }[];
  // team only
  imageUrl?: string;
  creatorId?: string;
  lastMessage:
    | { content: string; createdAt: string; fromSelf: boolean; senderName?: string }
    | null;
};

const SKILL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  professional: "Professional",
};

export default function FriendsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const myId = session?.user?.id || "";
  const [data, setData] = useState<FriendsData | null>(null);
  const [tab, setTab] = useState<"friends" | "groups" | "chats" | "incoming" | "outgoing" | "blocked">("friends");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [friendGroups, setFriendGroups] = useState<FriendGroup[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupMembers, setEditGroupMembers] = useState<string[]>([]);
  const [groupSaving, setGroupSaving] = useState(false);

  // Chats (combined inbox: 1:1 + group)
  const [chats, setChats] = useState<InboxItem[]>([]);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [newChatMembers, setNewChatMembers] = useState<string[]>([]);
  const [showFriendGroupShortcut, setShowFriendGroupShortcut] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [swipedChatKey, setSwipedChatKey] = useState<string | null>(null);

  // Friend search (Friends list tab)
  const [friendSearch, setFriendSearch] = useState("");

  // Blocked users
  const [blocked, setBlocked] = useState<BlockedEntry[]>([]);
  const [openMenu, setOpenMenu] = useState<{
    friendshipId: string;
    userId: string;
    userName: string;
    top: number;
    right: number;
  } | null>(null);

  // Friend search (within Create / Edit Group forms on the Groups tab)
  const [groupFormSearch, setGroupFormSearch] = useState("");

  // Friend search (within Create / Edit Chat modals on the Chats tab)
  const [chatFormSearch, setChatFormSearch] = useState("");

  // Edit-members modal (group chats only)
  const [editChatId, setEditChatId] = useState<string | null>(null);
  const [editChatName, setEditChatName] = useState("");
  const [editChatMembers, setEditChatMembers] = useState<string[]>([]);
  const [originalEditMembers, setOriginalEditMembers] = useState<string[]>([]);
  const [editChatCreatorId, setEditChatCreatorId] = useState<string>("");
  const [savingEditChat, setSavingEditChat] = useState(false);

  const loadFriends = () => {
    fetch("/api/friends").then((r) => r.json()).then(setData);
  };

  const loadFriendGroups = () => {
    fetch("/api/friend-groups").then((r) => r.json()).then(setFriendGroups);
  };

  const loadChats = () => {
    fetch("/api/inbox")
      .then((r) => r.json())
      .then((d) => setChats(Array.isArray(d.items) ? d.items : []));
  };

  const loadBlocked = () => {
    fetch("/api/block")
      .then((r) => r.json())
      .then((d) => setBlocked(Array.isArray(d) ? d : []));
  };

  const blockUser = async (otherUserId: string, name: string) => {
    if (!confirm(`Block ${name}? They won't be able to message you, send you a friend request, or see your posts. You'll also unfriend them.`)) return;
    setOpenMenu(null);
    await fetch("/api/block", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otherUserId }),
    });
    loadFriends();
    loadBlocked();
    loadChats();
  };

  const unblockUser = async (otherUserId: string) => {
    if (!confirm("Unblock this user?")) return;
    await fetch("/api/block", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otherUserId }),
    });
    loadBlocked();
  };

  const chatActionState = async (
    item: InboxItem,
    action: "pin" | "unpin" | "mute" | "unmute" | "leave" | "hide"
  ) => {
    setSwipedChatKey(null);
    await fetch("/api/inbox/state", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: item.type, id: item.id, action }),
    });
    loadChats();
  };

  const openEditChat = async (chatId: string) => {
    setSwipedChatKey(null);
    const res = await fetch(`/api/chats/${chatId}`);
    if (!res.ok) return;
    const data = await res.json();
    const memberIds = (data.participants as { id: string }[])
      .map((p) => p.id)
      .filter((id) => id !== myId);
    setEditChatId(chatId);
    setEditChatName(data.name || "");
    setEditChatMembers(memberIds);
    setOriginalEditMembers(memberIds);
    setEditChatCreatorId(data.creatorId || "");
    setChatFormSearch("");
  };

  const isEditChatCreator = editChatCreatorId === myId;

  const toggleEditChatMember = (id: string) => {
    // Non-creators cannot uncheck (remove) existing members — only add new ones.
    if (!isEditChatCreator && originalEditMembers.includes(id)) return;
    setEditChatMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const saveEditChat = async () => {
    if (!editChatId || savingEditChat) return;
    setSavingEditChat(true);
    const addMemberIds = editChatMembers.filter((id) => !originalEditMembers.includes(id));
    const removeMemberIds = originalEditMembers.filter((id) => !editChatMembers.includes(id));
    await fetch(`/api/chats/${editChatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editChatName,
        addMemberIds,
        removeMemberIds,
      }),
    });
    setEditChatId(null);
    loadChats();
    setSavingEditChat(false);
  };

  useEffect(() => {
    loadFriends();
    loadFriendGroups();
    loadChats();
    loadBlocked();
  }, []);

  const toggleNewChatMember = (id: string) => {
    setNewChatMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const useFriendGroupForChat = (g: FriendGroup) => {
    const ids = g.members.map((m) => m.user.id);
    setNewChatMembers(Array.from(new Set([...newChatMembers, ...ids])));
    setShowFriendGroupShortcut(false);
  };

  const createChat = async () => {
    if (newChatMembers.length < 1 || creatingChat) return;
    setCreatingChat(true);
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantIds: newChatMembers, name: newChatName.trim() }),
    });
    if (res.ok) {
      const chat = await res.json();
      setShowNewChatModal(false);
      setNewChatName("");
      setNewChatMembers([]);
      router.push(`/chat/group/${chat.id}`);
    }
    setCreatingChat(false);
  };

  const createFriendGroup = async () => {
    if (!newGroupName.trim()) return;
    setGroupSaving(true);
    await fetch("/api/friend-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newGroupName.trim(), memberIds: newGroupMembers }),
    });
    setNewGroupName("");
    setNewGroupMembers([]);
    setShowCreateForm(false);
    loadFriendGroups();
    setGroupSaving(false);
  };

  const startEditGroup = (g: FriendGroup) => {
    setEditingGroupId(g.id);
    setEditGroupName(g.name);
    setEditGroupMembers(g.members.map((m) => m.user.id));
    setGroupFormSearch("");
  };

  const saveEditGroup = async () => {
    if (!editingGroupId) return;
    setGroupSaving(true);
    const original = friendGroups.find((g) => g.id === editingGroupId);
    const originalIds = original?.members.map((m) => m.user.id) || [];
    const addMemberIds = editGroupMembers.filter((id) => !originalIds.includes(id));
    const removeMemberIds = originalIds.filter((id) => !editGroupMembers.includes(id));
    await fetch("/api/friend-groups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        friendGroupId: editingGroupId,
        name: editGroupName.trim(),
        addMemberIds,
        removeMemberIds,
      }),
    });
    setEditingGroupId(null);
    loadFriendGroups();
    setGroupSaving(false);
  };

  const deleteFriendGroup = async (friendGroupId: string) => {
    if (!confirm("Delete this group?")) return;
    await fetch("/api/friend-groups", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendGroupId }),
    });
    loadFriendGroups();
  };

  const toggleNewMember = (id: string) => {
    setNewGroupMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleEditMember = (id: string) => {
    setEditGroupMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const acceptRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    await fetch("/api/friends/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId }),
    });
    loadFriends();
    setActionLoading(null);
  };

  const rejectRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    await fetch("/api/friends/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId }),
    });
    loadFriends();
    setActionLoading(null);
  };

  const removeFriend = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    await fetch("/api/friends/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ friendshipId }),
    });
    loadFriends();
    setActionLoading(null);
  };

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-2xl p-5 shadow-sm flex items-center gap-4">
              <div className="skeleton w-12 h-12 rounded-full" />
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

  const tabs = [
    { key: "friends" as const, label: "Friends", count: data.friends.length },
    { key: "groups" as const, label: "Groups", count: friendGroups.length },
    { key: "chats" as const, label: "Chats", count: chats.length },
    { key: "incoming" as const, label: "Incoming", count: data.incomingRequests.length },
    { key: "outgoing" as const, label: "Sent", count: data.outgoingRequests.length },
    { key: "blocked" as const, label: "Blocked", count: blocked.length },
  ];

  const baseFriendsList =
    tab === "friends"
      ? data.friends
      : tab === "incoming"
      ? data.incomingRequests
      : tab === "outgoing"
      ? data.outgoingRequests
      : [];
  const friendsList =
    tab === "friends" && friendSearch.trim()
      ? baseFriendsList.filter((entry) =>
          entry.user.name.toLowerCase().includes(friendSearch.trim().toLowerCase())
        )
      : baseFriendsList;

  const formatChatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="animate-fade-in-up">
        <h1 className="font-display text-2xl font-bold text-court-green mb-1">
          Your Network
        </h1>
        <p className="text-gray-500 text-sm mb-6">Manage your tennis connections</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-2xl p-1.5 shadow-sm border border-court-green-pale/20 mb-6 animate-fade-in-up stagger-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              tab === t.key
                ? "bg-court-green text-white shadow-md"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  tab === t.key
                    ? "bg-white/20 text-white"
                    : t.key === "incoming"
                    ? "bg-ball-yellow text-court-green"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Groups tab */}
      {tab === "groups" && (
        <div className="space-y-3">
          <button
            onClick={() => {
              setShowCreateForm(!showCreateForm);
              setEditingGroupId(null);
              setGroupFormSearch("");
            }}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {showCreateForm ? "Cancel" : "Create New Group"}
          </button>

          {showCreateForm && (
            <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Group Name
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Close Friends, Coworkers"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-court-green text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Add Friends ({newGroupMembers.length} selected)
                </label>
                <div className="relative mb-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={groupFormSearch}
                    onChange={(e) => setGroupFormSearch(e.target.value)}
                    placeholder="Search friends..."
                    className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
                  />
                  {groupFormSearch && (
                    <button
                      onClick={() => setGroupFormSearch("")}
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
                <div className="max-h-60 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                  {data.friends.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No friends to add yet</p>
                  ) : (() => {
                    const filtered = data.friends.filter((f) =>
                      f.user.name.toLowerCase().includes(groupFormSearch.trim().toLowerCase())
                    );
                    if (filtered.length === 0) {
                      return <p className="text-sm text-gray-400 text-center py-4">No matches for &quot;{groupFormSearch}&quot;</p>;
                    }
                    return filtered.map((f) => (
                      <label
                        key={f.user.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={newGroupMembers.includes(f.user.id)}
                          onChange={() => toggleNewMember(f.user.id)}
                          className="w-4 h-4 accent-court-green"
                        />
                        <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                        <span className="text-sm font-medium text-gray-800">{f.user.name}</span>
                      </label>
                    ));
                  })()}
                </div>
              </div>
              <button
                onClick={createFriendGroup}
                disabled={groupSaving || !newGroupName.trim()}
                className="btn-primary w-full"
              >
                {groupSaving ? "Creating..." : "Create Group"}
              </button>
            </div>
          )}

          {friendGroups.length === 0 && !showCreateForm ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No groups yet</h3>
              <p className="text-gray-500 text-sm max-w-xs mx-auto">
                Create friend lists like &quot;Close Friends&quot; or &quot;Coworkers&quot; to share posts with specific people.
              </p>
            </div>
          ) : (
            friendGroups.map((g) => (
              <div
                key={g.id}
                className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5"
              >
                {editingGroupId === g.id ? (
                  <div className="space-y-4">
                    <input
                      type="text"
                      value={editGroupName}
                      onChange={(e) => setEditGroupName(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-court-green text-sm font-semibold"
                    />
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                        Members ({editGroupMembers.length})
                      </label>
                      <div className="relative mb-2">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                          <circle cx="11" cy="11" r="8" />
                          <path d="M21 21l-4.35-4.35" />
                        </svg>
                        <input
                          type="text"
                          value={groupFormSearch}
                          onChange={(e) => setGroupFormSearch(e.target.value)}
                          placeholder="Search friends..."
                          className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
                        />
                        {groupFormSearch && (
                          <button
                            onClick={() => setGroupFormSearch("")}
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
                      <div className="max-h-60 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                        {(() => {
                          const filtered = data.friends.filter((f) =>
                            f.user.name.toLowerCase().includes(groupFormSearch.trim().toLowerCase())
                          );
                          if (filtered.length === 0) {
                            return <p className="text-sm text-gray-400 text-center py-4">No matches for &quot;{groupFormSearch}&quot;</p>;
                          }
                          return filtered.map((f) => (
                            <label
                              key={f.user.id}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={editGroupMembers.includes(f.user.id)}
                                onChange={() => toggleEditMember(f.user.id)}
                                className="w-4 h-4 accent-court-green"
                              />
                              <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                              <span className="text-sm font-medium text-gray-800">{f.user.name}</span>
                            </label>
                          ));
                        })()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveEditGroup}
                        disabled={groupSaving}
                        className="btn-primary flex-1"
                      >
                        {groupSaving ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingGroupId(null)}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-display text-lg font-bold text-gray-900 truncate">
                          {g.name}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {g._count.members} {g._count.members === 1 ? "member" : "members"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => startEditGroup(g)}
                          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                          title="Edit group"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteFriendGroup(g.id)}
                          className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                          title="Delete group"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {g.members.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {g.members.slice(0, 8).map((m) => (
                          <div
                            key={m.user.id}
                            className="flex items-center gap-1.5 bg-court-green-pale/20 rounded-full pl-1 pr-2.5 py-1"
                          >
                            <Avatar name={m.user.name} image={m.user.profileImageUrl} size="sm" />
                            <span className="text-xs font-medium text-gray-700">
                              {m.user.name.split(" ")[0]}
                            </span>
                          </div>
                        ))}
                        {g.members.length > 8 && (
                          <span className="text-xs text-gray-500 self-center">
                            +{g.members.length - 8} more
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Chats tab */}
      {tab === "chats" && (
        <div className="space-y-3">
          <button
            onClick={() => {
              setShowNewChatModal(true);
              setNewChatName("");
              setNewChatMembers([]);
              setChatFormSearch("");
            }}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Chat
          </button>

          <p className="text-xs text-gray-400 px-1">
            Tip: swipe left on any chat (direct, group, or team) to pin, mute, or hide it. Hidden chats reappear when a new message arrives.
          </p>

          {chats.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No conversations yet</h3>
              <p className="text-gray-500 text-sm max-w-xs mx-auto">
                Message a friend or start a group chat — pick a few people and get the conversation going.
              </p>
            </div>
          ) : (
            chats.map((chat) => {
              const key = `${chat.type}-${chat.id}`;
              const isPinned = !!chat.pinnedAt;
              const isMuted = chat.muted;
              return (
                <SwipeChatRow
                  key={key}
                  rowKey={key}
                  swipedKey={swipedChatKey}
                  setSwipedKey={setSwipedChatKey}
                  onTap={() => router.push(chat.href)}
                  onPin={() => chatActionState(chat, isPinned ? "unpin" : "pin")}
                  onMute={() => chatActionState(chat, isMuted ? "unmute" : "mute")}
                  onEdit={chat.type === "group" ? () => openEditChat(chat.id) : undefined}
                  onDelete={() => {
                    // Hide from this user's inbox only. For 1:1 the API maps "hide" to setting hiddenAt.
                    // For groups, "hide" sets hiddenAt on the user's ChatParticipant — others are unaffected,
                    // and any new message re-surfaces the chat. Use the chat thread's "Leave" button to
                    // actually exit a group chat for everyone.
                    chatActionState(chat, "hide");
                  }}
                  isPinned={isPinned}
                  isMuted={isMuted}
                >
                  <div className={`p-4 flex items-center gap-3 ${chat.type === "team" ? "bg-gradient-to-r from-court-green-pale/20 to-white" : "bg-white"}`}>
                    {/* Avatar */}
                    <div className="shrink-0">
                      {chat.type === "direct" && chat.avatarUser ? (
                        <Avatar
                          name={chat.avatarUser.name}
                          image={chat.avatarUser.profileImageUrl}
                          size="md"
                        />
                      ) : chat.type === "team" ? (
                        <div className="relative">
                          {chat.imageUrl ? (
                            <img
                              src={chat.imageUrl}
                              alt={chat.title}
                              className="w-11 h-11 rounded-xl object-cover shadow-md ring-2 ring-white"
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-base shadow-md ring-2 ring-white">
                              {chat.title.charAt(0).toUpperCase()}
                            </div>
                          )}
                          {/* Trophy badge */}
                          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-ball-yellow flex items-center justify-center shadow-sm ring-2 ring-white">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-court-green">
                              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
                              <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                              <path d="M4 22h16" />
                              <path d="M18 2H6v7a6 6 0 0012 0V2z" />
                            </svg>
                          </span>
                        </div>
                      ) : (
                        <div className="flex -space-x-3">
                          {(chat.participants || []).slice(0, 2).map((p) => (
                            <Avatar key={p.id} name={p.name} image={p.profileImageUrl} size="sm" />
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isPinned && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-court-green-soft shrink-0">
                              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
                            </svg>
                          )}
                          <h3 className="font-semibold text-gray-900 text-sm truncate">
                            {chat.title}
                          </h3>
                          {chat.type === "team" && (
                            <span className="text-[9px] font-bold tracking-wider text-court-green bg-court-green-pale/40 px-1.5 py-0.5 rounded uppercase shrink-0">
                              Team
                            </span>
                          )}
                          {isMuted && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 shrink-0">
                              <path d="M11 5L6 9H2v6h4l5 4V5z" />
                              <line x1="23" y1="9" x2="17" y2="15" />
                              <line x1="17" y1="9" x2="23" y2="15" />
                            </svg>
                          )}
                        </div>
                        <span className="text-xs text-gray-400 shrink-0">
                          {chat.lastMessage ? formatChatTime(chat.lastMessage.createdAt) : ""}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="text-xs text-gray-500 truncate">
                          {chat.lastMessage
                            ? `${chat.lastMessage.fromSelf ? "You" : chat.type === "group" || chat.type === "team" ? chat.lastMessage.senderName : ""}${chat.lastMessage.fromSelf || chat.type === "group" || chat.type === "team" ? ": " : ""}${chat.lastMessage.content || "(no text)"}`
                            : "No messages yet"}
                        </p>
                        {chat.unreadCount > 0 && (
                          <span className={`shrink-0 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center ${isMuted ? "bg-gray-400" : "bg-court-green"}`}>
                            {chat.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </SwipeChatRow>
              );
            })
          )}
        </div>
      )}

      {/* New Chat modal */}
      {showNewChatModal && (
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
          onClick={() => setShowNewChatModal(false)}
        >
          <div
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl min-h-screen sm:min-h-0 sm:my-8 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-display text-xl font-bold text-gray-900">New Group Chat</h2>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Chat Name (optional)
                </label>
                <input
                  type="text"
                  value={newChatName}
                  onChange={(e) => setNewChatName(e.target.value)}
                  placeholder="e.g. Doubles Crew"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-court-green text-sm"
                />
              </div>

              {friendGroups.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowFriendGroupShortcut(!showFriendGroupShortcut)}
                    className="text-xs font-semibold text-court-green hover:text-court-green-light flex items-center gap-1.5"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Use a friend group
                  </button>
                  {showFriendGroupShortcut && (
                    <div className="mt-2 space-y-1.5 border border-gray-100 rounded-xl p-2">
                      {friendGroups.map((g) => (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => useFriendGroupForChat(g)}
                          className="w-full text-left flex items-center justify-between p-2 rounded-lg hover:bg-gray-50"
                        >
                          <span className="text-sm font-medium text-gray-800">{g.name}</span>
                          <span className="text-xs text-gray-400">{g._count.members} members</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Pick Friends ({newChatMembers.length} selected)
                </label>
                <div className="relative mb-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={chatFormSearch}
                    onChange={(e) => setChatFormSearch(e.target.value)}
                    placeholder="Search friends..."
                    className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
                  />
                  {chatFormSearch && (
                    <button
                      onClick={() => setChatFormSearch("")}
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
                <div className="max-h-72 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                  {data.friends.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No friends to chat with yet</p>
                  ) : (() => {
                    const filtered = data.friends.filter((f) =>
                      f.user.name.toLowerCase().includes(chatFormSearch.trim().toLowerCase())
                    );
                    if (filtered.length === 0) {
                      return <p className="text-sm text-gray-400 text-center py-4">No matches for &quot;{chatFormSearch}&quot;</p>;
                    }
                    return filtered.map((f) => (
                      <label
                        key={f.user.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={newChatMembers.includes(f.user.id)}
                          onChange={() => toggleNewChatMember(f.user.id)}
                          className="w-4 h-4 accent-court-green"
                        />
                        <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                        <span className="text-sm font-medium text-gray-800">{f.user.name}</span>
                      </label>
                    ));
                  })()}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100">
              <button
                onClick={createChat}
                disabled={creatingChat || newChatMembers.length < 1}
                className="btn-primary w-full"
              >
                {creatingChat ? "Starting..." : "Start Chat"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Chat Members modal */}
      {editChatId && (
        <div
          className="fixed inset-0 z-[999] bg-black/50 flex items-start sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
          onClick={() => setEditChatId(null)}
        >
          <div
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl min-h-screen sm:min-h-0 sm:my-8 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-display text-xl font-bold text-gray-900">Edit Chat</h2>
              <button
                onClick={() => setEditChatId(null)}
                className="w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="p-5 space-y-4 flex-1 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Chat Name
                </label>
                <input
                  type="text"
                  value={editChatName}
                  onChange={(e) => setEditChatName(e.target.value)}
                  placeholder="Group name (optional)"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-court-green text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Members ({editChatMembers.length} + you)
                </label>
                <div className="relative mb-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    value={chatFormSearch}
                    onChange={(e) => setChatFormSearch(e.target.value)}
                    placeholder="Search friends..."
                    className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
                  />
                  {chatFormSearch && (
                    <button
                      onClick={() => setChatFormSearch("")}
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
                <div className="max-h-72 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                  {data.friends.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No friends to add yet</p>
                  ) : (() => {
                    const filtered = data.friends.filter((f) =>
                      f.user.name.toLowerCase().includes(chatFormSearch.trim().toLowerCase())
                    );
                    if (filtered.length === 0) {
                      return <p className="text-sm text-gray-400 text-center py-4">No matches for &quot;{chatFormSearch}&quot;</p>;
                    }
                    return filtered.map((f) => {
                      const isOriginal = originalEditMembers.includes(f.user.id);
                      const isLocked = !isEditChatCreator && isOriginal;
                      return (
                        <label
                          key={f.user.id}
                          className={`flex items-center gap-3 p-2 rounded-lg ${isLocked ? "cursor-not-allowed opacity-70" : "hover:bg-gray-50 cursor-pointer"}`}
                          title={isLocked ? "Only the chat creator can remove this member" : ""}
                        >
                          <input
                            type="checkbox"
                            checked={editChatMembers.includes(f.user.id)}
                            onChange={() => toggleEditChatMember(f.user.id)}
                            disabled={isLocked}
                            className="w-4 h-4 accent-court-green"
                          />
                          <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                          <span className="text-sm font-medium text-gray-800 flex-1">{f.user.name}</span>
                          {isLocked && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                              <path d="M7 11V7a5 5 0 0110 0v4" />
                            </svg>
                          )}
                        </label>
                      );
                    });
                  })()}
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {isEditChatCreator
                    ? "As the creator, you can add or remove members. Removed members lose access immediately."
                    : "You can add new members but only the creator can remove existing ones."}
                </p>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
              <button
                onClick={() => setEditChatId(null)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={saveEditChat}
                disabled={savingEditChat || editChatMembers.length < 1}
                className="btn-primary flex-1"
              >
                {savingEditChat ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Blocked tab */}
      {tab === "blocked" && (
        <div className="space-y-3">
          {blocked.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-400">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No blocked users</h3>
              <p className="text-gray-500 text-sm max-w-xs mx-auto">
                Blocked users can&apos;t message you, send friend requests, or see your posts.
              </p>
            </div>
          ) : (
            blocked.map((entry) => (
              <div
                key={entry.id}
                className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 flex items-center gap-4"
              >
                <Avatar name={entry.user.name} image={entry.user.profileImageUrl} size="lg" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{entry.user.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Blocked {new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <button
                  onClick={() => unblockUser(entry.user.id)}
                  className="btn-secondary btn-sm"
                >
                  Unblock
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Friends / Incoming / Outgoing list */}
      {tab !== "groups" && tab !== "chats" && tab !== "blocked" && (
      <div className="space-y-3">
          {tab === "friends" && data.friends.length > 0 && (
            <div className="relative">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                placeholder="Search friends..."
                className="w-full pl-10 pr-9 py-2.5 bg-white border border-court-green-pale/20 rounded-2xl text-sm shadow-sm focus:outline-none focus:border-court-green transition-colors"
              />
              {friendSearch && (
                <button
                  onClick={() => setFriendSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-500"
                  aria-label="Clear search"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {friendsList.length === 0 ? (
            <div className="animate-fade-in-up stagger-2 text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
                </svg>
              </div>
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">
                {tab === "friends" && friendSearch.trim()
                  ? "No friends match"
                  : tab === "friends"
                  ? "No doubles partner yet"
                  : tab === "incoming"
                  ? "No pending requests"
                  : "No sent requests"}
              </h3>
              <p className="text-gray-500 text-sm mb-6">
                {tab === "friends" && friendSearch.trim()
                  ? `No friends found for "${friendSearch}". Try a different name.`
                  : tab === "friends"
                  ? "Discover players and send them a friend request!"
                  : tab === "incoming"
                  ? "When someone sends you a request, it will appear here."
                  : "Requests you've sent will show up here."}
              </p>
              {tab === "friends" && !friendSearch.trim() && (
                <Link href="/search" className="btn-primary">
                  Discover Players
                </Link>
              )}
            </div>
          ) : (
            friendsList.map((entry, i) => (
              <div
                key={entry.friendshipId}
                className={`animate-fade-in-up stagger-${Math.min(i + 2, 5)} bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 flex items-center gap-4 card-hover`}
              >
                <Link href={`/profile/${entry.user.id}`}>
                  <Avatar name={entry.user.name} image={entry.user.profileImageUrl} size="lg" />
                </Link>
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/profile/${entry.user.id}`}
                    className="font-semibold text-gray-900 hover:text-court-green transition-colors text-sm"
                  >
                    {entry.user.name}
                  </Link>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {SKILL_LABELS[entry.user.skillLevel] || entry.user.skillLevel}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {tab === "friends" && (
                    <>
                      <Link
                        href={`/chat/${entry.user.id}`}
                        className="btn-primary btn-sm"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                        </svg>
                        Chat
                      </Link>
                      {/* Kebab menu — opens a portal-rendered dropdown */}
                      <button
                        onClick={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setOpenMenu({
                            friendshipId: entry.friendshipId,
                            userId: entry.user.id,
                            userName: entry.user.name,
                            top: rect.bottom + 4,
                            right: window.innerWidth - rect.right,
                          });
                        }}
                        className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500"
                        aria-label="More actions"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="12" cy="5" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>
                    </>
                  )}
                  {tab === "incoming" && (
                    <>
                      <button
                        onClick={() => acceptRequest(entry.friendshipId)}
                        disabled={actionLoading === entry.friendshipId}
                        className="btn-primary btn-sm"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => rejectRequest(entry.friendshipId)}
                        disabled={actionLoading === entry.friendshipId}
                        className="btn-danger btn-sm"
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {tab === "outgoing" && (
                    <span className="text-xs text-gray-400 font-medium px-3 py-1.5 bg-gray-50 rounded-full">
                      Pending
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Portal-rendered kebab dropdown — escapes all parent stacking contexts */}
      {openMenu && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 z-[998]" onClick={() => setOpenMenu(null)} />
          <div
            className="fixed z-[999] w-44 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col"
            style={{ top: openMenu.top, right: openMenu.right }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const id = openMenu.friendshipId;
                const name = openMenu.userName;
                setOpenMenu(null);
                if (confirm(`Unfriend ${name}?`)) removeFriend(id);
              }}
              className="block w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <span className="inline-flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="18" y1="8" x2="23" y2="13" />
                  <line x1="23" y1="8" x2="18" y2="13" />
                </svg>
                Unfriend
              </span>
            </button>
            <button
              type="button"
              onClick={() => blockUser(openMenu.userId, openMenu.userName)}
              className="block w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 border-t border-gray-100"
            >
              <span className="inline-flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
                Block
              </span>
            </button>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

/* ----------------------------- SwipeChatRow ----------------------------- */
function SwipeChatRow({
  rowKey,
  swipedKey,
  setSwipedKey,
  onTap,
  onPin,
  onMute,
  onEdit,
  onDelete,
  isPinned,
  isMuted,
  children,
}: {
  rowKey: string;
  swipedKey: string | null;
  setSwipedKey: (k: string | null) => void;
  onTap: () => void;
  onPin: () => void;
  onMute: () => void;
  onEdit?: () => void;
  onDelete: () => void;
  isPinned: boolean;
  isMuted: boolean;
  children: React.ReactNode;
}) {
  const BTN_WIDTH = 72;
  const buttonCount = onEdit ? 4 : 3;
  const ACTION_WIDTH = BTN_WIDTH * buttonCount;
  const OPEN_THRESHOLD = 60; // px past which a left-swipe opens the row
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
      // Suppress the synthetic click that follows a real drag (touch and mouse).
      suppressClickRef.current = true;
      setTimeout(() => { suppressClickRef.current = false; }, 350);
    }

    if (!moved) {
      // No drag — leave state as-is; let the click handler decide.
      return;
    }

    if (wasSwiped) {
      // If the user dragged right past the close threshold, close it.
      if (finalDrag > -ACTION_WIDTH + OPEN_THRESHOLD) {
        setDragX(0);
        setSwipedKey(null);
      } else {
        setDragX(-ACTION_WIDTH);
      }
    } else {
      // Was closed; if dragged left past threshold, open it.
      if (finalDrag < -OPEN_THRESHOLD) {
        setDragX(-ACTION_WIDTH);
        setSwipedKey(rowKey);
      } else {
        setDragX(0);
      }
    }
  };

  // Snap to swiped/closed when external state changes
  useEffect(() => {
    if (swiped) setDragX(-ACTION_WIDTH);
    else setDragX(0);
  }, [swiped]);

  const offset = draggingRef.current ? dragX : swiped ? -ACTION_WIDTH : 0;

  return (
    <div className="relative overflow-hidden rounded-2xl shadow-sm border border-court-green-pale/20 bg-white">
      {/* Action buttons (revealed by swipe) */}
      <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: ACTION_WIDTH }}>
        <button
          onClick={(e) => { e.stopPropagation(); onPin(); }}
          style={{ width: BTN_WIDTH }}
          className="bg-court-green text-white text-[11px] font-semibold flex flex-col items-center justify-center gap-1"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z" />
          </svg>
          {isPinned ? "Unpin" : "Pin"}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMute(); }}
          style={{ width: BTN_WIDTH }}
          className="bg-amber-500 text-white text-[11px] font-semibold flex flex-col items-center justify-center gap-1"
        >
          {isMuted ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5L6 9H2v6h4l5 4V5z" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          )}
          {isMuted ? "Unmute" : "Mute"}
        </button>
        {onEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            style={{ width: BTN_WIDTH }}
            className="bg-blue-500 text-white text-[11px] font-semibold flex flex-col items-center justify-center gap-1"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ width: BTN_WIDTH }}
          className="bg-red-500 text-white text-[11px] font-semibold flex flex-col items-center justify-center gap-1"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A10.93 10.93 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
          Hide
        </button>
      </div>

      {/* Sliding content */}
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
            // If a real drag just happened, swallow the synthetic click.
            if (suppressClickRef.current) {
              e.preventDefault();
              e.stopPropagation();
              return;
            }
            // Tapping an open row closes it without navigating.
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
