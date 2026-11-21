"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import { z } from "zod";
import Avatar from "@/components/Avatar";
import { formatRating } from "@/lib/profileLabels";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  listFriends as sbListFriends,
  listPendingRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend as sbRemoveFriend,
  blockUser as sbBlockUser,
  unblockUser as sbUnblockUser,
  listMyFriendGroups,
  listFriendGroupMembers,
  createFriendGroup as sbCreateFriendGroup,
  addFriendGroupMembers,
  createStandaloneChat,
  updateStandaloneChat,
  leaveClub as sbLeaveClub,
  deleteClub as sbDeleteClub,
  getClubChatId,
  updateFriendGroupSettings,
  getChat,
  listChatParticipants,
  markDmRead,
  markChatRead,
  markTeamRead,
} from "@/lib/supabase/queries";
import { useCachedQuery } from "@/lib/useCachedQuery";
import { loadInbox } from "@/lib/inboxLoader";
import { errorMessage } from "@/lib/errorMessage";
import { GROUP_CHAT_MEMBER_LIMIT, isGroupChatCapacityError } from "@/lib/groupChatCapacity";
import { filterNonmemberFriends } from "@/lib/friendGroupMemberPicker";

type FriendUser = {
  id: string;
  name: string;
  profileImageUrl: string;
  skillLevel: string;
  gender?: string;
  ageRange?: string;
  ratingSystem?: string;
  ntrpRating?: number | null;
  utrRating?: number | null;
};

type FriendEntry = {
  friendshipId: string;
  user: FriendUser;
};

type FriendsData = {
  friends: FriendEntry[];
  incomingRequests: FriendEntry[];
  outgoingRequests: FriendEntry[];
};

type FriendGroupView = {
  id: string;
  name: string;
  ownerId: string;
  membersCanAdd: boolean;
  members: { user: { id: string; name: string; profileImageUrl: string } }[];
  _count: { members: number };
};

type BlockedEntry = {
  id: string;
  createdAt: string;
  user: FriendUser;
};

const newFriendGroupSchema = z.object({
  name: z.string().trim().min(1),
  memberIds: z.array(z.uuid()),
});

type InboxItem = {
  type: "direct" | "group" | "team";
  id: string;
  title: string;
  href: string;
  unreadCount: number;
  muted: boolean;
  pinnedAt: string | null;
  // group-only: "session" when auto-created from a filled find-players post;
  // "friendGroup" when the chat belongs to a friend group.
  kind?: "session" | "group" | "friendGroup";
  // direct only
  avatarUser?: { id: string; name: string; profileImageUrl: string };
  // group / team
  participants?: { id: string; name: string; profileImageUrl: string }[];
  // team only
  imageUrl?: string;
  creatorId?: string;
  // team only — set when this is the backing group for an event
  eventId?: string | null;
  lastMessage:
    | { content: string; createdAt: string; fromSelf: boolean; senderName?: string }
    | null;
};

export default function FriendsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const myId = session?.user?.id || "";
  const chatCapacityDialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"friends" | "groups" | "chats">("friends");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editMembersCanAdd, setEditMembersCanAdd] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);

  // Clubs
  const [addingMembers, setAddingMembers] = useState(false);
  const [addingToGroupId, setAddingToGroupId] = useState<string | null>(null);
  const [addMemberSelection, setAddMemberSelection] = useState<string[]>([]);
  const [clubError, setClubError] = useState<{ id: string; message: string } | null>(null);

  // Chats (combined inbox: 1:1 + group). Shares the "chat:inbox" cache key
  // with src/app/chat/page.tsx so navigating between Friends → Chat → Friends
  // doesn't refetch the same data.
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [newChatMembers, setNewChatMembers] = useState<string[]>([]);
  const [showFriendGroupShortcut, setShowFriendGroupShortcut] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [chatWriteError, setChatWriteError] = useState("");
  const [swipedChatKey, setSwipedChatKey] = useState<string | null>(null);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);

  // Friend search (Friends list tab)
  const [friendSearch, setFriendSearch] = useState("");

  // Blocked users
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
  const [originalChatSize, setOriginalChatSize] = useState(0);
  const [editChatCreatorId, setEditChatCreatorId] = useState<string>("");
  const [savingEditChat, setSavingEditChat] = useState(false);

  const friendsQuery = useCachedQuery<FriendsData>("friends:network", async () => {
    const supabase = createSupabaseBrowserClient();
    const [friendRows, pendingRows] = await Promise.all([
      sbListFriends(supabase),
      listPendingRequests(supabase),
    ]);
    return {
      friends: friendRows.map((u) => ({
        friendshipId: u.id, // placeholder
        user: {
          id: u.id,
          name: u.name,
          profileImageUrl: u.profile_image_url,
          skillLevel: u.skill_level,
          gender: u.gender,
          ageRange: u.age_range,
          ratingSystem: u.rating_system,
          ntrpRating: u.ntrp_rating,
          utrRating: u.utr_rating,
        },
      })),
      incomingRequests: pendingRows
        .filter((r) => r.direction === "incoming")
        .map((r) => ({
          friendshipId: r.id,
          user: {
            id: r.other.id,
            name: r.other.name,
            profileImageUrl: r.other.profile_image_url,
            skillLevel: r.other.skill_level,
            gender: r.other.gender,
            ageRange: r.other.age_range,
            ratingSystem: r.other.rating_system,
            ntrpRating: r.other.ntrp_rating,
            utrRating: r.other.utr_rating,
          },
        })),
      outgoingRequests: pendingRows
        .filter((r) => r.direction === "outgoing")
        .map((r) => ({
          friendshipId: r.id,
          user: {
            id: r.other.id,
            name: r.other.name,
            profileImageUrl: r.other.profile_image_url,
            skillLevel: r.other.skill_level,
            gender: r.other.gender,
            ageRange: r.other.age_range,
            ratingSystem: r.other.rating_system,
            ntrpRating: r.other.ntrp_rating,
            utrRating: r.other.utr_rating,
          },
        })),
    };
  });
  const data = friendsQuery.data ?? null;
  const loadFriends = friendsQuery.refetch;

  const friendGroupsQuery = useCachedQuery<FriendGroupView[]>("friends:friend-groups", async () => {
    const supabase = createSupabaseBrowserClient();
    const groups = await listMyFriendGroups(supabase);
    return Promise.all(
      groups.map(async (c) => {
        const members = await listFriendGroupMembers(supabase, c.id);
        return {
          id: c.id,
          name: c.name,
          ownerId: c.owner_id,
          membersCanAdd: c.members_can_add,
          members: members.map((m) => ({
            user: {
              id: m.user.id,
              name: m.user.name,
              profileImageUrl: m.user.profile_image_url,
            },
          })),
          _count: { members: members.length },
        };
      })
    );
  });
  const friendGroups = friendGroupsQuery.data ?? [];
  const loadFriendGroups = friendGroupsQuery.refetch;

  // Reuses the "chat:inbox" cache populated by src/app/chat/page.tsx, so
  // bouncing between Friends and Chat doesn't refetch the same data.
  // The fetcher lives in src/lib/inboxLoader.ts — both pages MUST use the
  // same loader, otherwise whichever populates the cache first wins and
  // the other page flashes the wrong list (this is how team chats started
  // disappearing from /chat after a /friends visit).
  const chatsQuery = useCachedQuery<InboxItem[]>("chat:inbox", () =>
    loadInbox(createSupabaseBrowserClient(), myId || undefined)
  );
  const chats = chatsQuery.data ?? [];
  const loadChats = chatsQuery.refetch;

  const blockedQuery = useCachedQuery<BlockedEntry[]>(
    "friends:blocked",
    async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: rows } = await supabase
        .from("blocks")
        .select(
          `id, blocked_id, created_at,
           user:profiles!blocks_blocked_id_fkey ( id, name, profile_image_url )`
        );
      return ((rows ?? []) as unknown as Array<{
        id: string;
        blocked_id: string;
        created_at: string;
        user: { id: string; name: string; profile_image_url: string };
      }>).map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        user: {
          id: r.user.id,
          name: r.user.name,
          profileImageUrl: r.user.profile_image_url,
          skillLevel: "",
        },
      }));
    }
  );
  const blocked = blockedQuery.data ?? [];
  const loadBlocked = blockedQuery.refetch;

  const blockUser = async (otherUserId: string, name: string) => {
    if (!confirm(`Block ${name}? They won't be able to message you, send you a friend request, or see your posts. You'll also unfriend them.`)) return;
    setOpenMenu(null);
    const supabase = createSupabaseBrowserClient();
    await sbBlockUser(supabase, otherUserId);
    await sbRemoveFriend(supabase, otherUserId);
    loadFriends();
    loadBlocked();
    loadChats();
  };

  const unblockUser = async (otherUserId: string) => {
    if (!confirm("Unblock this user?")) return;
    const supabase = createSupabaseBrowserClient();
    await sbUnblockUser(supabase, otherUserId);
    loadBlocked();
  };

  const chatActionState = async (
    item: InboxItem,
    action: "pin" | "unpin" | "mute" | "unmute" | "leave" | "hide"
  ) => {
    setSwipedChatKey(null);
    // For the read-state action, mark the conversation read; pin/mute/hide
    // would need participant-row updates which we'll add when the chat
    // settings UI is rebuilt.
    if (action === "hide") {
      const supabase = createSupabaseBrowserClient();
      if (item.type === "direct") {
        await markDmRead(supabase, item.id);
      } else if (item.type === "group") {
        await markChatRead(supabase, item.id);
      } else if (item.type === "team") {
        await markTeamRead(supabase, item.id);
      }
    }
    loadChats();
  };

  const openEditChat = async (chatId: string) => {
    setSwipedChatKey(null);
    const supabase = createSupabaseBrowserClient();
    const [chat, parts] = await Promise.all([
      getChat(supabase, chatId),
      listChatParticipants(supabase, chatId),
    ]);
    if (!chat) return;
    const memberIds = parts.map((p) => p.user_id).filter((id) => id !== myId);
    setEditChatId(chatId);
    setEditChatName(chat.name || "");
    setEditChatMembers(memberIds);
    setOriginalEditMembers(memberIds);
    setOriginalChatSize(parts.length);
    setChatWriteError("");
    setEditChatCreatorId(chat.creator_id || "");
    setChatFormSearch("");
  };

  const isEditChatCreator = editChatCreatorId === myId;

  const toggleEditChatMember = (id: string) => {
    // Non-creators cannot uncheck (remove) existing members — only add new ones.
    if (!isEditChatCreator && originalEditMembers.includes(id)) return;
    setEditChatMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const showChatCapacityAlert = () => {
    const dialog = chatCapacityDialog.current;
    if (dialog && !dialog.open) dialog.showModal();
  };

  const saveEditChat = async () => {
    if (!editChatId || savingEditChat) return;
    const addIds = editChatMembers.filter((id) => !originalEditMembers.includes(id));
    const removeIds = originalEditMembers.filter((id) => !editChatMembers.includes(id));
    if (addIds.length > 0 && originalChatSize + addIds.length - removeIds.length > GROUP_CHAT_MEMBER_LIMIT) {
      showChatCapacityAlert();
      return;
    }

    setChatWriteError("");
    setSavingEditChat(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await updateStandaloneChat(supabase, editChatId, { name: editChatName, addIds, removeIds });
      setEditChatId(null);
      loadChats();
    } catch (err) {
      if (isGroupChatCapacityError(err)) {
        showChatCapacityAlert();
      } else {
        setChatWriteError(errorMessage(err, "Couldn't save chat changes."));
      }
    } finally {
      setSavingEditChat(false);
    }
  };

  // Initial fetches are owned by the four useCachedQuery hooks above —
  // no separate mount effect needed.

  const toggleNewChatMember = (id: string) => {
    setNewChatMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const useFriendGroupForChat = (group: FriendGroupView) => {
    const members = new Set(group.members.map(({ user }) => user.id));
    const ids = (data?.friends ?? []).map(({ user }) => user.id).filter((id) => members.has(id));
    setNewChatMembers(Array.from(new Set([...newChatMembers, ...ids])));
    setShowFriendGroupShortcut(false);
  };

  const createChat = async () => {
    if (newChatMembers.length < 1 || creatingChat) return;
    if (newChatMembers.length + 1 > GROUP_CHAT_MEMBER_LIMIT) {
      showChatCapacityAlert();
      return;
    }

    setChatWriteError("");
    setCreatingChat(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const chatId = await createStandaloneChat(supabase, newChatName, newChatMembers);
      setShowNewChatModal(false);
      setNewChatName("");
      setNewChatMembers([]);
      router.push(`/chat/group/${chatId}`);
    } catch (err) {
      if (isGroupChatCapacityError(err)) {
        showChatCapacityAlert();
      } else {
        setChatWriteError(errorMessage(err, "Couldn't start the chat."));
      }
    } finally {
      setCreatingChat(false);
    }
  };

  const createFriendGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingGroup) return;

    const result = newFriendGroupSchema.safeParse({
      name: newGroupName,
      memberIds: newGroupMembers,
    });
    if (!result.success) {
      setCreateGroupError("Check the group name and selected friends.");
      return;
    }

    const { name, memberIds } = result.data;
    if (memberIds.length + 1 > GROUP_CHAT_MEMBER_LIMIT) {
      showChatCapacityAlert();
      return;
    }

    setCreatingGroup(true);
    setCreateGroupError("");
    try {
      const supabase = createSupabaseBrowserClient();
      await sbCreateFriendGroup(supabase, name, memberIds);
      await loadFriendGroups();
      setNewGroupName("");
      setNewGroupMembers([]);
      setShowCreateForm(false);
      loadChats();
    } catch (err) {
      if (isGroupChatCapacityError(err)) {
        showChatCapacityAlert();
      } else {
        setCreateGroupError(errorMessage(err, "Couldn't create the group."));
      }
    } finally {
      setCreatingGroup(false);
    }
  };

  const toggleAddMemberSelection = (id: string) => {
    setAddMemberSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const addSelectedFriends = async (group: FriendGroupView) => {
    if (addMemberSelection.length === 0 || addingMembers) return;
    const currentMembers = new Set(group.members.map(({ user }) => user.id));
    const newMembers = addMemberSelection.filter((id) => !currentMembers.has(id));
    if (newMembers.length > 0 && group._count.members + newMembers.length > GROUP_CHAT_MEMBER_LIMIT) {
      showChatCapacityAlert();
      return;
    }

    setAddingMembers(true);
    setClubError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await addFriendGroupMembers(supabase, group.id, newMembers);
      await loadFriendGroups();
      setAddingToGroupId(null);
      setAddMemberSelection([]);
    } catch (err) {
      if (isGroupChatCapacityError(err)) {
        showChatCapacityAlert();
        loadFriendGroups();
      } else {
        setClubError({ id: group.id, message: errorMessage(err, "Couldn't add friends to the group.") });
      }
    } finally {
      setAddingMembers(false);
    }
  };

  const openClubChat = async (club: FriendGroupView) => {
    if (openingChatId) return;
    setClubError(null);
    setOpeningChatId(club.id);
    try {
      const supabase = createSupabaseBrowserClient();
      const chatId = await getClubChatId(supabase, club.id);
      if (!chatId) {
        setClubError({ id: club.id, message: "This group has no chat yet." });
        return;
      }
      router.push(`/chat/group/${chatId}`);
    } catch (err) {
      setClubError({ id: club.id, message: errorMessage(err, "Could not open chat.") });
    } finally {
      setOpeningChatId(null);
    }
  };

  const handleLeaveClub = async (club: FriendGroupView) => {
    if (!confirm(`Leave ${club.name}? You'll also leave its group chat.`)) return;
    setClubError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await sbLeaveClub(supabase, club.id);
      loadFriendGroups();
      loadChats();
    } catch (err) {
      setClubError({ id: club.id, message: errorMessage(err, "Couldn't leave the group.") });
    }
  };

  const handleDeleteClub = async (club: FriendGroupView) => {
    if (!confirm(`Delete ${club.name}? This removes the group and its chat for all members.`)) return;
    setClubError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await sbDeleteClub(supabase, club.id);
      loadFriendGroups();
      loadChats();
    } catch (err) {
      setClubError({ id: club.id, message: errorMessage(err, "Couldn't delete the group.") });
    }
  };

  const startEditGroup = (group: FriendGroupView) => {
    setClubError(null);
    setAddingToGroupId(null);
    setEditingGroupId(group.id);
    setEditGroupName(group.name);
    setEditMembersCanAdd(group.membersCanAdd);
  };

  const saveEditGroup = async (event: FormEvent<HTMLFormElement>, groupId: string) => {
    event.preventDefault();
    if (groupSaving) return;
    setGroupSaving(true);
    setClubError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await updateFriendGroupSettings(supabase, groupId, {
        name: editGroupName,
        membersCanAdd: editMembersCanAdd,
      });
      await loadFriendGroups();
      setEditingGroupId(null);
      loadChats();
    } catch (err) {
      setClubError({ id: groupId, message: errorMessage(err, "Couldn't save group settings.") });
    } finally {
      setGroupSaving(false);
    }
  };

  const toggleNewMember = (id: string) => {
    setNewGroupMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const acceptRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    const supabase = createSupabaseBrowserClient();
    await acceptFriendRequest(supabase, friendshipId);
    loadFriends();
    setActionLoading(null);
  };

  const rejectRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    const supabase = createSupabaseBrowserClient();
    await rejectFriendRequest(supabase, friendshipId);
    loadFriends();
    setActionLoading(null);
  };

  const removeFriend = async (otherUserId: string) => {
    setActionLoading(otherUserId);
    const supabase = createSupabaseBrowserClient();
    await sbRemoveFriend(supabase, otherUserId);
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
    { key: "groups" as const, label: "Friend Groups", count: friendGroups.length },
    { key: "chats" as const, label: "Chats", count: chats.length },
  ];

  const baseFriendsList =
    tab === "friends"
      ? data.friends
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
            aria-pressed={tab === t.key}
            className={`flex-1 flex items-center justify-center gap-1 px-2 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all sm:gap-2 sm:px-3 ${
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
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Friend Groups tab */}
      {tab === "groups" && (
        <div className="space-y-3">
          <button
            onClick={() => {
              setShowCreateForm(!showCreateForm);
              setEditingGroupId(null);
              setAddingToGroupId(null);
              setCreateGroupError("");
              setGroupFormSearch("");
            }}
            aria-expanded={showCreateForm}
            disabled={creatingGroup}
            className={`${showCreateForm ? "btn-secondary" : "btn-primary"} w-full flex items-center justify-center gap-2`}
          >
            {!showCreateForm && (
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            )}
            {showCreateForm ? "Cancel" : "New group"}
          </button>

          {showCreateForm && (
            <form onSubmit={createFriendGroup} className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 space-y-4">
              <div>
                <label htmlFor="new-friend-group-name" className="block text-sm font-semibold text-gray-700 mb-2">
                  Group name
                </label>
                <input
                  id="new-friend-group-name"
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Green Lake Weekend Hitters"
                  required
                  disabled={creatingGroup}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-court-green text-sm placeholder:text-gray-600"
                />
              </div>
              <div>
                <label htmlFor="new-friend-group-search" className="block text-sm font-semibold text-gray-700 mb-1">
                  Add friends ({newGroupMembers.length} selected)
                </label>
                <p className="text-xs text-gray-600 mb-2">Selected friends join this private group immediately.</p>
                <div className="relative mb-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    id="new-friend-group-search"
                    type="text"
                    value={groupFormSearch}
                    onChange={(e) => setGroupFormSearch(e.target.value)}
                    placeholder="Search friends..."
                    className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-xl text-sm placeholder:text-gray-600 focus:outline-none focus:border-court-green"
                  />
                  {groupFormSearch && (
                    <button
                      type="button"
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
                    <p className="text-sm text-gray-600 text-center py-4">No friends to select yet</p>
                  ) : (() => {
                    const filtered = data.friends.filter((f) =>
                      f.user.name.toLowerCase().includes(groupFormSearch.trim().toLowerCase())
                    );
                    if (filtered.length === 0) {
                      return <p className="text-sm text-gray-600 text-center py-4">No matches for &quot;{groupFormSearch}&quot;</p>;
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
                          disabled={creatingGroup}
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
                type="submit"
                disabled={creatingGroup || !newGroupName.trim()}
                className="btn-primary w-full"
              >
                {creatingGroup ? "Creating..." : "Create group"}
              </button>
            </form>
          )}

          {createGroupError && <p role="alert" className="text-sm text-red-700">{createGroupError}</p>}

          {friendGroups.length === 0 && !showCreateForm && (
            <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <div className="w-14 h-14 bg-court-green-pale/20 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-court-green-soft">
                  <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="font-display text-lg font-bold text-gray-800 mb-2">No friend groups yet</h2>
              <p className="text-gray-600 text-sm max-w-xs mx-auto px-4">
                Create a group to plan games, chat, and share posts with friends.
              </p>
            </div>
          )}
          {friendGroups.map((club) => {
              const isOwner = club.ownerId === myId;
              const canAddFriends = isOwner || club.membersCanAdd;
              const availableFriends = filterNonmemberFriends(data.friends, club.members.map((m) => m.user.id));
              return (
                <div
                  key={club.id}
                  className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display text-lg font-bold text-gray-900 truncate">
                        {club.name}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {club._count.members} {club._count.members === 1 ? "member" : "members"}
                        {isOwner && " · You created this group"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openClubChat(club)}
                        disabled={openingChatId === club.id}
                        className="p-2 rounded-lg hover:bg-court-green-pale/30 text-court-green disabled:opacity-60"
                        title="Open group chat"
                      >
                        {openingChatId === club.id ? (
                          <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                            <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                          </svg>
                        )}
                      </button>
                      {canAddFriends && (
                        <button
                          onClick={() => {
                            if (addingToGroupId !== club.id && club._count.members >= GROUP_CHAT_MEMBER_LIMIT) {
                              showChatCapacityAlert();
                              return;
                            }
                            setAddingToGroupId(addingToGroupId === club.id ? null : club.id);
                            setAddMemberSelection([]);
                            setEditingGroupId(null);
                            setClubError(null);
                          }}
                          className="p-2 rounded-lg hover:bg-court-green-pale/30 text-court-green"
                          title="Add friends"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                            <circle cx="8.5" cy="7" r="4" />
                            <line x1="20" y1="8" x2="20" y2="14" />
                            <line x1="23" y1="11" x2="17" y2="11" />
                          </svg>
                        </button>
                      )}
                      {isOwner ? (
                        <button
                          onClick={() => handleDeleteClub(club)}
                          className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                          title="Delete group"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleLeaveClub(club)}
                          className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                          title="Leave group"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => editingGroupId === club.id ? setEditingGroupId(null) : startEditGroup(club)}
                      aria-expanded={editingGroupId === club.id}
                      className="text-sm font-semibold text-court-green hover:underline mb-3"
                    >
                      Group settings
                    </button>
                  )}
                  {isOwner && editingGroupId === club.id && (
                    <form onSubmit={(event) => void saveEditGroup(event, club.id)} className="space-y-3 mb-3 rounded-xl border border-gray-200 p-3">
                      <label className="block text-sm font-semibold text-gray-800">
                        Group name
                        <input
                          value={editGroupName}
                          onChange={(event) => setEditGroupName(event.target.value)}
                          disabled={groupSaving}
                          required
                          className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                        />
                      </label>
                      <label className="flex items-start gap-3 text-sm text-gray-800">
                        <input
                          type="checkbox"
                          checked={editMembersCanAdd}
                          onChange={(event) => setEditMembersCanAdd(event.target.checked)}
                          disabled={groupSaving}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-court-green"
                        />
                        <span>
                          <span className="font-semibold">Allow members to add friends</span>
                          <span className="mt-1 block text-xs text-gray-600">
                            Members can add people from their own friends list.
                          </span>
                        </span>
                      </label>
                      <button type="submit" disabled={groupSaving || !editGroupName.trim()} className="btn-primary w-full">
                        {groupSaving ? "Saving..." : "Save settings"}
                      </button>
                    </form>
                  )}
                  {clubError?.id === club.id && (
                    <p role="alert" className="text-xs text-red-600 mb-2">{clubError.message}</p>
                  )}
                  {club.members.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {club.members.slice(0, 8).map((m) => (
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
                      {club.members.length > 8 && (
                        <span className="text-xs text-gray-500 self-center">
                          +{club.members.length - 8} more
                        </span>
                      )}
                    </div>
                  )}
                  {canAddFriends && addingToGroupId === club.id && (
                    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                      <p className="text-sm font-semibold text-gray-800">
                        Add friends ({addMemberSelection.length} selected)
                      </p>
                      <div className="max-h-48 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                        {availableFriends.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-4">
                            No other friends to add.
                          </p>
                        ) : (
                          availableFriends.map((f) => (
                            <label
                              key={f.user.id}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={addMemberSelection.includes(f.user.id)}
                                onChange={() => toggleAddMemberSelection(f.user.id)}
                                disabled={addingMembers}
                                className="w-4 h-4 accent-court-green"
                              />
                              <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                              <span className="text-sm font-medium text-gray-800">{f.user.name}</span>
                            </label>
                          ))
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => addSelectedFriends(club)}
                          disabled={addingMembers || addMemberSelection.length === 0}
                          className="btn-primary flex-1"
                        >
                          {addingMembers ? "Adding..." : "Add to group"}
                        </button>
                        <button
                          onClick={() => setAddingToGroupId(null)}
                          className="btn-secondary flex-1"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
          })}
        </div>
      )}

      {/* Chats tab */}
      {tab === "chats" && (
        <div className="space-y-3">
          <button
            onClick={() => {
              setShowNewChatModal(true);
              setChatWriteError("");
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
              const isFriendGroup = chat.type === "group" && chat.kind === "friendGroup";
              return (
                <SwipeChatRow
                  key={key}
                  rowKey={key}
                  swipedKey={swipedChatKey}
                  setSwipedKey={setSwipedChatKey}
                  onTap={() => router.push(chat.href)}
                  onPin={() => chatActionState(chat, isPinned ? "unpin" : "pin")}
                  onMute={() => chatActionState(chat, isMuted ? "unmute" : "mute")}
                  onEdit={chat.type === "group" && !isFriendGroup ? () => openEditChat(chat.id) : undefined}
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
                  <div className={`p-4 flex items-center gap-3 ${
                    chat.type === "group" && chat.kind === "session"
                      ? "bg-gradient-to-r from-court-green-pale/25 to-white border-l-4 border-l-court-green"
                      : isFriendGroup
                      ? "bg-gradient-to-r from-friend-group-purple-tint to-white border-l-4 border-l-friend-group-purple"
                      : chat.type === "team" && chat.eventId
                      ? "bg-gradient-to-r from-ball-yellow/20 to-white border-l-4 border-l-ball-yellow"
                      : chat.type === "team"
                      ? "bg-gradient-to-r from-clay/15 to-white border-l-4 border-l-clay"
                      : "bg-white"
                  }`}>
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
                          ) : chat.eventId ? (
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-court-green-soft to-court-green flex items-center justify-center text-white font-bold text-base shadow-md ring-2 ring-white">
                              {chat.title.charAt(0).toUpperCase()}
                            </div>
                          ) : (
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-clay to-clay-light flex items-center justify-center text-white font-bold text-base shadow-md ring-2 ring-white">
                              {chat.title.charAt(0).toUpperCase()}
                            </div>
                          )}
                          {chat.eventId ? (
                            /* Event badge — crossed rackets */
                            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-ball-yellow flex items-center justify-center shadow-sm ring-2 ring-white">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-court-green">
                                <ellipse cx="7" cy="6.5" rx="3" ry="4" transform="rotate(-25 7 6.5)" />
                                <line x1="9" y1="9.5" x2="17" y2="21.5" />
                                <ellipse cx="17" cy="6.5" rx="3" ry="4" transform="rotate(25 17 6.5)" />
                                <line x1="15" y1="9.5" x2="7" y2="21.5" />
                              </svg>
                            </span>
                          ) : (
                            /* Team badge — trophy */
                            <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-clay flex items-center justify-center shadow-sm ring-2 ring-white">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
                                <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
                                <path d="M4 22h16" />
                                <path d="M18 2H6v7a6 6 0 0012 0V2z" />
                              </svg>
                            </span>
                          )}
                        </div>
                      ) : isFriendGroup ? (
                        <div className="relative">
                          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-friend-group-purple to-friend-group-purple-deep flex items-center justify-center text-white font-bold text-base shadow-md ring-2 ring-white">
                            {chat.title.charAt(0).toUpperCase()}
                          </div>
                          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-friend-group-purple flex items-center justify-center shadow-sm ring-2 ring-white">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M23 21v-2a4 4 0 00-3-3.87" />
                              <path d="M16 3.13a4 4 0 010 7.75" />
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
                          {chat.type === "team" && chat.eventId ? (
                            <span className="text-[9px] font-bold tracking-wider text-court-green bg-ball-yellow/60 px-1.5 py-0.5 rounded uppercase shrink-0">
                              Event
                            </span>
                          ) : chat.type === "team" ? (
                            <span className="text-[9px] font-bold tracking-wider text-clay bg-clay/15 px-1.5 py-0.5 rounded uppercase shrink-0">
                              Team
                            </span>
                          ) : null}
                          {chat.type === "group" && chat.kind === "session" && (
                            <span className="text-[9px] font-bold tracking-wider text-white bg-court-green px-1.5 py-0.5 rounded uppercase shrink-0">
                              🎾 Game
                            </span>
                          )}
                          {isFriendGroup && (
                            <span className="text-[9px] font-bold tracking-wider text-friend-group-purple-deep bg-friend-group-purple-tint px-1.5 py-0.5 rounded uppercase shrink-0">
                              Group
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
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl min-h-screen sm:min-h-0 sm:my-8 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0"
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
              {chatWriteError && <p role="alert" className="mb-3 text-sm text-red-700">{chatWriteError}</p>}
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
            className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-2xl min-h-screen sm:min-h-0 sm:my-8 flex flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0"
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

            {chatWriteError && <p role="alert" className="px-5 pb-3 text-sm text-red-700">{chatWriteError}</p>}
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

      {/* Friends list */}
      {tab !== "groups" && tab !== "chats" && (
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
                  : "No doubles partner yet"}
              </h3>
              <p className="text-gray-500 text-sm mb-6">
                {tab === "friends" && friendSearch.trim()
                  ? `No friends found for "${friendSearch}". Try a different name.`
                  : "Discover players and send them a friend request!"}
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
                  {formatRating(entry.user) && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {formatRating(entry.user)}
                    </p>
                  )}
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
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <dialog
        ref={chatCapacityDialog}
        role="alertdialog"
        aria-labelledby="group-chat-limit-title"
        aria-describedby="group-chat-limit-description"
        className="m-auto w-11/12 max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-xl backdrop:bg-gray-900/50 sm:p-6"
      >
        <h2 id="group-chat-limit-title" className="font-display text-xl font-bold text-gray-900">
          Group chat limit reached
        </h2>
        <p id="group-chat-limit-description" className="mt-2 text-sm text-gray-700">
          Group chats can have up to {GROUP_CHAT_MEMBER_LIMIT} people. Choose fewer people or try again when there’s room.
        </p>
        <form method="dialog" className="mt-5">
          <button className="btn-primary w-full">OK</button>
        </form>
      </dialog>

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
