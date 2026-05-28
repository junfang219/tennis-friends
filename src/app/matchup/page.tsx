"use client";

import { useState } from "react";
import { useSession } from "@/lib/supabase/nextauth-compat";
import Link from "next/link";
import Avatar from "@/components/Avatar";
import { isAtLeast, ROLE } from "@/lib/groupRoles";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listTeamListings, listMyGroups, createTeamListing } from "@/lib/supabase/queries";
import { useCachedQuery } from "@/lib/useCachedQuery";
import { errorMessage } from "@/lib/errorMessage";

type Listing = {
  id: string;
  title: string;
  description: string;
  format: string;
  ntrpMin: number | null;
  ntrpMax: number | null;
  city: string;
  status: string;
  createdAt: string;
  group: { id: string; name: string; imageUrl: string };
  createdBy: { id: string; name: string; profileImageUrl: string };
};

type MyTeam = {
  id: string;
  name: string;
  ownerId: string;
  members: { userId: string; role: string }[];
};

const FORMAT_LABELS: Record<string, string> = {
  any: "Any format",
  singles: "Singles",
  doubles: "Doubles",
  mixed_doubles: "Mixed doubles",
};

function ntrpLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "All NTRP";
  if (min != null && max != null) return `NTRP ${min.toFixed(1)}–${max.toFixed(1)}`;
  if (min != null) return `NTRP ${min.toFixed(1)}+`;
  return `up to NTRP ${(max as number).toFixed(1)}`;
}

export default function MatchUpPage() {
  const { data: session } = useSession();

  const [formatFilter, setFormatFilter] = useState<string>("");
  const [cityFilter, setCityFilter] = useState<string>("");

  const [showCreate, setShowCreate] = useState(false);
  const [createTeamId, setCreateTeamId] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createFormat, setCreateFormat] = useState("any");
  const [createNtrpMin, setCreateNtrpMin] = useState("");
  const [createNtrpMax, setCreateNtrpMax] = useState("");
  const [createCity, setCreateCity] = useState("");
  const [createExpiresDays, setCreateExpiresDays] = useState("30");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");

  const listingsQuery = useCachedQuery<Listing[]>(
    `matchup:listings:${formatFilter || "any"}:${cityFilter.trim()}`,
    async () => {
      const supabase = createSupabaseBrowserClient();
      const rows = await listTeamListings(supabase, {
        format: formatFilter || undefined,
        city: cityFilter.trim() || undefined,
      });
      return rows.map((l) => ({
        id: l.id,
        title: l.title,
        description: l.description,
        format: l.format,
        ntrpMin: l.ntrp_min,
        ntrpMax: l.ntrp_max,
        city: l.city,
        status: l.status,
        createdAt: l.created_at,
        group: {
          id: l.group?.id ?? l.group_id,
          name: l.group?.name ?? "",
          imageUrl: l.group?.image_url ?? "",
        },
        createdBy: { id: l.created_by_id, name: "", profileImageUrl: "" },
      }));
    },
  );
  const listings = listingsQuery.data ?? [];
  const loading = listingsQuery.isLoading;
  const loadError = listingsQuery.error
    ? listingsQuery.error.message || "Couldn't load listings."
    : "";
  const loadListings = listingsQuery.refetch;

  const myTeamsQuery = useCachedQuery<MyTeam[]>("matchup:my-teams", async () => {
    const supabase = createSupabaseBrowserClient();
    const rows = await listMyGroups(supabase);
    // myTeams shape doesn't carry members list anymore — pass an empty
    // placeholder; the "can post" check below will narrow to teams the
    // user owns (which RLS-wise are all in listMyGroups).
    return rows.map((g) => ({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      members: [],
    }));
  });
  const myTeams = myTeamsQuery.data ?? [];

  const userId = session?.user?.id || "";
  // listMyGroups returns groups where the user is owner/manager/captain/
  // member; here we surface only teams the user owns (the simplest pre-MVP
  // guard until we wire has_group_role-style helper to the client).
  const teamsICanPostFor = myTeams.filter((t) => t.ownerId === userId);
  void isAtLeast; void ROLE; // legacy gate vars retained for follow-up wiring

  const createListing = async () => {
    if (!createTitle.trim() || !createTeamId) return;
    setCreating(true);
    setCreateErr("");
    let success = false;
    try {
      const supabase = createSupabaseBrowserClient();
      const expiresAt = createExpiresDays
        ? new Date(Date.now() + Number(createExpiresDays) * 86400_000).toISOString()
        : null;
      await createTeamListing(supabase, createTeamId, {
        title: createTitle.trim(),
        description: createDescription.trim(),
        format: createFormat as "singles" | "doubles" | "mixed_doubles" | "any",
        ntrp_min: createNtrpMin ? Number(createNtrpMin) : null,
        ntrp_max: createNtrpMax ? Number(createNtrpMax) : null,
        city: createCity.trim(),
        expires_at: expiresAt,
      });
      success = true;
    } catch (err) {
      setCreateErr(errorMessage(err, "Failed to create listing"));
    }
    const res = { ok: success };
    if (res.ok) {
      setShowCreate(false);
      setCreateTitle("");
      setCreateDescription("");
      setCreateFormat("any");
      setCreateNtrpMin("");
      setCreateNtrpMax("");
      setCreateCity("");
      setCreateExpiresDays("30");
      await loadListings();
    }
    // The error path already set createErr inside the try/catch above.
    setCreating(false);
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-gray-900">MatchUp</h1>
          <p className="text-xs text-gray-500">Teams looking for players</p>
        </div>
        {teamsICanPostFor.length > 0 && (
          <button onClick={() => setShowCreate((v) => !v)} className="btn-primary px-3 py-1.5 text-xs">
            {showCreate ? "Cancel" : "+ Post for a team"}
          </button>
        )}
      </div>

      {showCreate && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 space-y-2">
          <select
            value={createTeamId}
            onChange={(e) => setCreateTeamId(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-court-green"
          >
            <option value="">Pick a team you manage…</option>
            {teamsICanPostFor.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <input
            type="text"
            value={createTitle}
            onChange={(e) => setCreateTitle(e.target.value)}
            placeholder="Title (e.g. Looking for a 4.0 doubles player)"
            maxLength={120}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
          />
          <textarea
            value={createDescription}
            onChange={(e) => setCreateDescription(e.target.value)}
            placeholder="Details (when you play, format, what you're looking for)"
            rows={3}
            maxLength={1000}
            className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green resize-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={createFormat} onChange={(e) => setCreateFormat(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white">
              {Object.entries(FORMAT_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
            <input
              type="text"
              value={createCity}
              onChange={(e) => setCreateCity(e.target.value)}
              placeholder="City"
              maxLength={60}
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
            />
            <input
              type="number"
              step="0.5"
              min="1"
              max="7"
              value={createNtrpMin}
              onChange={(e) => setCreateNtrpMin(e.target.value)}
              placeholder="NTRP min"
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
            />
            <input
              type="number"
              step="0.5"
              min="1"
              max="7"
              value={createNtrpMax}
              onChange={(e) => setCreateNtrpMax(e.target.value)}
              placeholder="NTRP max"
              className="px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-court-green"
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs text-gray-500 inline-flex items-center gap-1.5">
              Expires in
              <input
                type="number"
                min="1"
                max="90"
                value={createExpiresDays}
                onChange={(e) => setCreateExpiresDays(e.target.value)}
                className="w-14 px-2 py-1 border border-gray-200 rounded text-sm"
              />
              days
            </label>
            <button onClick={createListing} disabled={creating || !createTitle.trim() || !createTeamId} className="btn-primary px-4">
              {creating ? "Posting..." : "Post listing"}
            </button>
          </div>
          {createErr && <p className="text-xs text-red-600">{createErr}</p>}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 mb-4 flex items-center gap-2 text-sm">
        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
        >
          <option value="">All formats</option>
          {Object.entries(FORMAT_LABELS).filter(([v]) => v !== "any").map(([v, label]) => (
            <option key={v} value={v}>{label}</option>
          ))}
        </select>
        <input
          type="text"
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          placeholder="City filter"
          className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-court-green"
        />
      </div>

      {loadError && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {loadError}{" "}
          <button
            onClick={() => { void loadListings(); }}
            className="underline font-semibold ml-1"
          >
            Retry
          </button>
        </div>
      )}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton w-full h-28 rounded-2xl" />)}
        </div>
      ) : listings.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-court-green-pale/30 flex items-center justify-center text-2xl">🎾</div>
          <p className="text-sm font-semibold text-gray-700">No open listings</p>
          <p className="text-xs text-gray-400 mt-1">
            Check back later or {teamsICanPostFor.length > 0 ? "post one yourself" : "ask your team manager to post one"}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {listings.map((l) => (
            <div key={l.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-start gap-3">
                <Link href={`/groups/${l.group.id}`} className="shrink-0">
                  {l.group.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.group.imageUrl} alt={l.group.name} className="w-10 h-10 rounded-xl object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-court-green to-court-green-soft flex items-center justify-center text-white font-bold text-sm">
                      {l.group.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/groups/${l.group.id}`} className="text-xs font-semibold text-court-green-soft hover:text-court-green">
                    {l.group.name}
                  </Link>
                  <h3 className="text-sm font-bold text-gray-900 mt-0.5">{l.title}</h3>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-500 flex-wrap">
                    <span className="px-2 py-0.5 bg-court-green-pale/30 text-court-green rounded-full font-semibold">
                      {FORMAT_LABELS[l.format] || l.format}
                    </span>
                    <span className="px-2 py-0.5 bg-gray-100 rounded-full">{ntrpLabel(l.ntrpMin, l.ntrpMax)}</span>
                    {l.city && <span>📍 {l.city}</span>}
                  </div>
                  {l.description && <p className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">{l.description}</p>}
                  <div className="flex items-center gap-2 mt-3">
                    <Avatar name={l.createdBy.name} image={l.createdBy.profileImageUrl} size="sm" />
                    <span className="text-[11px] text-gray-500">Posted by {l.createdBy.name}</span>
                    <Link
                      href={`/messages?to=${l.createdBy.id}`}
                      className="ml-auto text-xs font-semibold text-court-green-soft hover:text-court-green"
                    >
                      Reach out →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
