"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
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
  deleteFriendGroup as sbDeleteFriendGroup,
  listMyClubs,
  listPendingClubInvitees,
  createClub as sbCreateClub,
  inviteToClub as sbInviteToClub,
  leaveClub as sbLeaveClub,
  deleteClub as sbDeleteClub,
  getClubChatId,
  getChat,
  listChatParticipants,
  markDmRead,
  markChatRead,
  markTeamRead,
} from "@/lib/supabase/queries";
import { useCachedQuery } from "@/lib/useCachedQuery";
import { loadInbox } from "@/lib/inboxLoader";
import { errorMessage } from "@/lib/errorMessage";
import { filterInvitableFriends } from "@/lib/clubInvitePicker";

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

type FriendGroup = {
  id: string;
  name: string;
  members: { user: { id: string; name: string; profileImageUrl: string } }[];
  _count: { members: number };
};

// Club = invite-grown friend group (kind='club'): any member can invite
// their own friends; invitees join via the requests page.
type ClubView = {
  id: string;
  name: string;
  ownerId: string;
  members: { user: { id: string; name: string; profileImageUrl: string } }[];
  pendingInvitees: { inviteId: string; user: { id: string; name: string; profileImageUrl: string } }[];
  _count: { members: number };
};

type BlockedEntry = {
  id: string;
  createdAt: string;
  user: FriendUser;
};

type InboxItem = {
  type: "direct" | "group" | "team";
  id: string;
  title: string;
  href: string;
  unreadCount: number;
  muted: boolean;
  pinnedAt: string | null;
  // group-only: "session" when auto-created from a filled find-players post
  kind?: "session" | "group";
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
  const [tab, setTab] = useState<"friends" | "groups" | "chats">("friends");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupMembers, setEditGroupMembers] = useState<string[]>([]);
  const [groupSaving, setGroupSaving] = useState(false);

  // Clubs
  const [showCreateClubForm, setShowCreateClubForm] = useState(false);
  const [newClubName, setNewClubName] = useState("");
  const [newClubInvites, setNewClubInvites] = useState<string[]>([]);
  const [clubSaving, setClubSaving] = useState(false);
  const [invitingClubId, setInvitingClubId] = useState<string | null>(null);
  const [clubInviteSelection, setClubInviteSelection] = useState<string[]>([]);
  const [clubError, setClubError] = useState<{ id: string; message: string } | null>(null);

  // Chats (combined inbox: 1:1 + group). Shares the "chat:inbox" cache key
  // with src/app/chat/page.tsx so navigating between Friends → Chat → Friends
  // doesn't refetch the same data.
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatName, setNewChatName] = useState("");
  const [newChatMembers, setNewChatMembers] = useState<string[]>([]);
  const [showFriendGroupShortcut, setShowFriendGroupShortcut] = useState(false);
  const [creatingChat, setCreatingChat] = useState(false);
  const [swipedChatKey, setSwipedChatKey] = useState<string | null>(null);
  const [openingChatId, setOpeningChatId] = useState<string | null>(null);
  const [openChatError, setOpenChatError] = useState<{ id: string; message: string } | null>(null);

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

  const friendGroupsQuery = useCachedQuery<FriendGroup[]>(
    "friends:friend-groups",
    async () => {
      const supabase = createSupabaseBrowserClient();
      const groups = await listMyFriendGroups(supabase);
      // Fetch members for each. Small N so a sequential fan-out is fine.
      return Promise.all(
        groups.map(async (g) => {
          const members = await listFriendGroupMembers(supabase, g.id);
          return {
            id: g.id,
            name: g.name,
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
    }
  );
  const friendGroups = friendGroupsQuery.data ?? [];
  const loadFriendGroups = friendGroupsQuery.refetch;

  // Clubs I'm a member of (not just owner — clubs grow by member invites).
  const clubsQuery = useCachedQuery<ClubView[]>("friends:clubs", async () => {
    const supabase = createSupabaseBrowserClient();
    const clubs = await listMyClubs(supabase);
    return Promise.all(
      clubs.map(async (c) => {
        const [members, pending] = await Promise.all([
          listFriendGroupMembers(supabase, c.id),
          listPendingClubInvitees(supabase, c.id),
        ]);
        return {
          id: c.id,
          name: c.name,
          ownerId: c.owner_id,
          members: members.map((m) => ({
            user: {
              id: m.user.id,
              name: m.user.name,
              profileImageUrl: m.user.profile_image_url,
            },
          })),
          pendingInvitees: pending
            .filter((p) => p.invitee)
            .map((p) => ({
              inviteId: p.id,
              user: {
                id: p.invitee!.id,
                name: p.invitee!.name,
                profileImageUrl: p.invitee!.profile_image_url,
              },
            })),
          _count: { members: members.length },
        };
      })
    );
  });
  const clubs = clubsQuery.data ?? [];
  const loadClubs = clubsQuery.refetch;

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
    setEditChatCreatorId(chat.creator_id || "");
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
    const supabase = createSupabaseBrowserClient();
    await supabase.from("chats").update({ name: editChatName }).eq("id", editChatId);
    if (addMemberIds.length > 0) {
      await supabase.from("chat_participants").insert(
        addMemberIds.map((uid) => ({ chat_id: editChatId, user_id: uid }))
      );
    }
    if (removeMemberIds.length > 0) {
      await supabase
        .from("chat_participants")
        .delete()
        .eq("chat_id", editChatId)
        .in("user_id", removeMemberIds);
    }
    setEditChatId(null);
    loadChats();
    setSavingEditChat(false);
  };

  // Initial fetches are owned by the four useCachedQuery hooks above —
  // no separate mount effect needed.

  const toggleNewChatMember = (id: string) => {
    setNewChatMembers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const useFriendGroupForChat = (g: FriendGroup) => {
    const ids = g.members.map((m) => m.user.id);
    setNewChatMembers(Array.from(new Set([...newChatMembers, ...ids])));
    setShowFriendGroupShortcut(false);
  };

  const openFriendGroupChat = async (g: FriendGroup) => {
    if (g._count.members < 1 || openingChatId) return;
    setOpenChatError(null);
    setOpeningChatId(g.id);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setOpenChatError({ id: g.id, message: "Not signed in." });
        return;
      }
      // Look for an existing chat backing this friend group; create if none.
      const { data: existing } = await supabase
        .from("chats")
        .select("id")
        .eq("friend_group_id", g.id)
        .maybeSingle();
      let chatId = existing?.id;
      if (!chatId) {
        const { data: created, error: createErr } = await supabase
          .from("chats")
          .insert({
            name: g.name,
            creator_id: auth.user.id,
            friend_group_id: g.id,
          })
          .select("id")
          .single();
        if (createErr || !created) {
          setOpenChatError({ id: g.id, message: createErr?.message ?? "Could not open chat." });
          return;
        }
        chatId = created.id;
        const participantIds = Array.from(new Set([auth.user.id, ...g.members.map((m) => m.user.id)]));
        await supabase.from("chat_participants").insert(
          participantIds.map((uid) => ({ chat_id: chatId!, user_id: uid }))
        );
      }
      router.push(`/chat/group/${chatId}`);
    } catch (err) {
      setOpenChatError({
        id: g.id,
        message: errorMessage(err, "Network error"),
      });
    } finally {
      setOpeningChatId(null);
    }
  };

  const createChat = async () => {
    if (newChatMembers.length < 1 || creatingChat) return;
    setCreatingChat(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setCreatingChat(false);
        return;
      }
      const { data: chat, error: createErr } = await supabase
        .from("chats")
        .insert({ creator_id: auth.user.id, name: newChatName.trim() })
        .select("id")
        .single();
      if (!createErr && chat) {
        const participantIds = Array.from(new Set([auth.user.id, ...newChatMembers]));
        await supabase.from("chat_participants").insert(
          participantIds.map((uid) => ({ chat_id: chat.id, user_id: uid }))
        );
        setShowNewChatModal(false);
        setNewChatName("");
        setNewChatMembers([]);
        router.push(`/chat/group/${chat.id}`);
      }
    } catch {
      // ignore
    }
    setCreatingChat(false);
  };

  const createFriendGroup = async () => {
    if (!newGroupName.trim()) return;
    setGroupSaving(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await sbCreateFriendGroup(supabase, newGroupName.trim(), newGroupMembers);
    } catch {
      // ignore
    }
    setNewGroupName("");
    setNewGroupMembers([]);
    setShowCreateForm(false);
    loadFriendGroups();
    setGroupSaving(false);
  };

  const createClub = async () => {
    if (!newClubName.trim() || clubSaving) return;
    setClubSaving(true);
    setClubError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await sbCreateClub(supabase, newClubName.trim(), newClubInvites);
      setNewClubName("");
      setNewClubInvites([]);
      setShowCreateClubForm(false);
      loadClubs();
      loadChats(); // club chat is created with the club
    } catch (err) {
      setClubError({ id: "create", message: errorMessage(err, "Couldn't create the club.") });
    }
    setClubSaving(false);
  };

  const toggleNewClubInvite = (id: string) => {
    setNewClubInvites((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleClubInviteSelection = (id: string) => {
    setClubInviteSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const sendClubInvites = async (clubId: string) => {
    if (clubInviteSelection.length === 0 || clubSaving) return;
    setClubSaving(true);
    setClubError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      for (const uid of clubInviteSelection) {
        await sbInviteToClub(supabase, clubId, uid);
      }
      setInvitingClubId(null);
      setClubInviteSelection([]);
      loadClubs();
    } catch (err) {
      setClubError({ id: clubId, message: errorMessage(err, "Couldn't send invites.") });
    }
    setClubSaving(false);
  };

  const openClubChat = async (club: ClubView) => {
    if (openingChatId) return;
    setClubError(null);
    setOpeningChatId(club.id);
    try {
      const supabase = createSupabaseBrowserClient();
      const chatId = await getClubChatId(supabase, club.id);
      if (!chatId) {
        setClubError({ id: club.id, message: "This club has no chat yet." });
        return;
      }
      router.push(`/chat/group/${chatId}`);
    } catch (err) {
      setClubError({ id: club.id, message: errorMessage(err, "Could not open chat.") });
    } finally {
      setOpeningChatId(null);
    }
  };

  const handleLeaveClub = async (club: ClubView) => {
    if (!confirm(`Leave ${club.name}? You'll also leave its group chat.`)) return;
    setClubError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await sbLeaveClub(supabase, club.id);
      loadClubs();
      loadChats();
    } catch (err) {
      setClubError({ id: club.id, message: errorMessage(err, "Couldn't leave the club.") });
    }
  };

  const handleDeleteClub = async (club: ClubView) => {
    if (!confirm(`Delete ${club.name}? This removes the club and its chat for all members.`)) return;
    setClubError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      await sbDeleteClub(supabase, club.id);
      loadClubs();
      loadChats();
    } catch (err) {
      setClubError({ id: club.id, message: errorMessage(err, "Couldn't delete the club.") });
    }
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
    const supabase = createSupabaseBrowserClient();
    await supabase
      .from("friend_groups")
      .update({ name: editGroupName.trim() })
      .eq("id", editingGroupId);
    if (addMemberIds.length > 0) {
      await supabase.from("friend_group_members").insert(
        addMemberIds.map((uid) => ({ friend_group_id: editingGroupId, user_id: uid }))
      );
    }
    if (removeMemberIds.length > 0) {
      await supabase
        .from("friend_group_members")
        .delete()
        .eq("friend_group_id", editingGroupId)
        .in("user_id", removeMemberIds);
    }
    setEditingGroupId(null);
    loadFriendGroups();
    setGroupSaving(false);
  };

  const deleteFriendGroup = async (friendGroupId: string) => {
    if (!confirm("Delete this circle?")) return;
    const supabase = createSupabaseBrowserClient();
    await sbDeleteFriendGroup(supabase, friendGroupId);
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
    { key: "groups" as const, label: "Groups", count: friendGroups.length + clubs.length },
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
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Groups tab: Circles (private lists) + Clubs (invite-grown) */}
      {tab === "groups" && (
        <div className="space-y-3">
          <div className="px-1">
            <h2 className="font-display text-lg font-bold text-gray-800">Circles</h2>
            <p className="text-xs text-gray-500">
              Private friend lists you manage — for sharing posts and starting chats.
            </p>
          </div>
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
            {showCreateForm ? "Cancel" : "New Circle"}
          </button>

          {showCreateForm && (
            <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Circle Name
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
                {groupSaving ? "Creating..." : "Create Circle"}
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
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No circles yet</h3>
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
                        {g._count.members > 0 && (
                          <button
                            onClick={() => openFriendGroupChat(g)}
                            disabled={openingChatId === g.id}
                            className="p-2 rounded-lg hover:bg-court-green-pale/30 text-court-green disabled:opacity-60"
                            title="Open group chat"
                          >
                            {openingChatId === g.id ? (
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
                        )}
                        <button
                          onClick={() => startEditGroup(g)}
                          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                          title="Edit circle"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => deleteFriendGroup(g.id)}
                          className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                          title="Delete circle"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    {openChatError?.id === g.id && (
                      <p className="text-xs text-red-600 mb-2">{openChatError.message}</p>
                    )}
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

          {/* Clubs section */}
          <div className="px-1 pt-4">
            <h2 className="font-display text-lg font-bold text-gray-800">Clubs</h2>
            <p className="text-xs text-gray-500">
              Communities that grow by invitation — every member can invite their own friends.
            </p>
          </div>
          <button
            onClick={() => {
              setShowCreateClubForm(!showCreateClubForm);
              setInvitingClubId(null);
              setClubError(null);
            }}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {showCreateClubForm ? "Cancel" : "New Club"}
          </button>

          {showCreateClubForm && (
            <div className="bg-white rounded-2xl shadow-sm border border-court-green-pale/20 p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Club Name
                </label>
                <input
                  type="text"
                  value={newClubName}
                  onChange={(e) => setNewClubName(e.target.value)}
                  placeholder="e.g. Greenlake Weekend Hitters"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:outline-none focus:border-court-green text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
                  Invite Friends ({newClubInvites.length} selected)
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  They&apos;ll get an invitation to accept — and can invite their own friends once they join.
                </p>
                <div className="max-h-60 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                  {data.friends.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No friends to invite yet</p>
                  ) : (
                    data.friends.map((f) => (
                      <label
                        key={f.user.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={newClubInvites.includes(f.user.id)}
                          onChange={() => toggleNewClubInvite(f.user.id)}
                          className="w-4 h-4 accent-court-green"
                        />
                        <Avatar name={f.user.name} image={f.user.profileImageUrl} size="sm" />
                        <span className="text-sm font-medium text-gray-800">{f.user.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              {clubError?.id === "create" && (
                <p className="text-xs text-red-600">{clubError.message}</p>
              )}
              <button
                onClick={createClub}
                disabled={clubSaving || !newClubName.trim()}
                className="btn-primary w-full"
              >
                {clubSaving ? "Creating..." : "Create Club"}
              </button>
            </div>
          )}

          {clubs.length === 0 && !showCreateClubForm ? (
            <div className="text-center py-10 bg-white rounded-2xl shadow-sm border border-court-green-pale/20">
              <h3 className="font-display text-lg font-bold text-gray-800 mb-2">No clubs yet</h3>
              <p className="text-gray-500 text-sm max-w-xs mx-auto">
                Start a club and invite friends — they can bring their own friends, and everyone can post and look for players together.
              </p>
            </div>
          ) : (
            clubs.map((club) => {
              const isOwner = club.ownerId === myId;
              const invitableFriends = filterInvitableFriends(
                data.friends,
                club.members.map((m) => m.user.id),
                club.pendingInvitees.map((p) => p.user.id)
              );
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
                        {club.pendingInvitees.length > 0 && ` · ${club.pendingInvitees.length} invited`}
                        {isOwner && " · You created this club"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openClubChat(club)}
                        disabled={openingChatId === club.id}
                        className="p-2 rounded-lg hover:bg-court-green-pale/30 text-court-green disabled:opacity-60"
                        title="Open club chat"
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
                      <button
                        onClick={() => {
                          setInvitingClubId(invitingClubId === club.id ? null : club.id);
                          setClubInviteSelection([]);
                          setClubError(null);
                        }}
                        className="p-2 rounded-lg hover:bg-court-green-pale/30 text-court-green"
                        title="Invite friends"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                          <circle cx="8.5" cy="7" r="4" />
                          <line x1="20" y1="8" x2="20" y2="14" />
                          <line x1="23" y1="11" x2="17" y2="11" />
                        </svg>
                      </button>
                      {isOwner ? (
                        <button
                          onClick={() => handleDeleteClub(club)}
                          className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                          title="Delete club"
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
                          title="Leave club"
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
                  {clubError?.id === club.id && (
                    <p className="text-xs text-red-600 mb-2">{clubError.message}</p>
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
                      {club.pendingInvitees.map((p) => (
                        <div
                          key={p.user.id}
                          className="flex items-center gap-1.5 bg-gray-100 rounded-full pl-1 pr-2.5 py-1 opacity-70"
                          title="Invitation pending"
                        >
                          <Avatar name={p.user.name} image={p.user.profileImageUrl} size="sm" />
                          <span className="text-xs font-medium text-gray-500">
                            {p.user.name.split(" ")[0]} · invited
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {invitingClubId === club.id && (
                    <div className="mt-4 space-y-3 border-t border-gray-100 pt-4">
                      <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wide">
                        Invite Your Friends ({clubInviteSelection.length} selected)
                      </label>
                      <div className="max-h-48 overflow-y-auto space-y-1.5 border border-gray-100 rounded-xl p-2">
                        {invitableFriends.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-4">
                            All your friends are already in this club or invited.
                          </p>
                        ) : (
                          invitableFriends.map((f) => (
                            <label
                              key={f.user.id}
                              className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={clubInviteSelection.includes(f.user.id)}
                                onChange={() => toggleClubInviteSelection(f.user.id)}
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
                          onClick={() => sendClubInvites(club.id)}
                          disabled={clubSaving || clubInviteSelection.length === 0}
                          className="btn-primary flex-1"
                        >
                          {clubSaving ? "Sending..." : "Send Invites"}
                        </button>
                        <button
                          onClick={() => setInvitingClubId(null)}
                          className="btn-secondary flex-1"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
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
                  <div className={`p-4 flex items-center gap-3 ${
                    chat.type === "group" && chat.kind === "session"
                      ? "bg-gradient-to-r from-court-green-pale/25 to-white border-l-4 border-l-court-green"
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
