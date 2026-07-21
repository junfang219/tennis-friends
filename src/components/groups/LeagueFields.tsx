"use client";

// USTA league fields editor, shared by Settings → Seasons (create form and
// per-season League editor) and the create-team USTA wizard. The draft model
// lives in src/lib/leagueDraft.ts (re-exported here for convenience).

import {
  DIVISION_OPTIONS,
  LINEUP_PRESETS,
  defaultRatingScheme,
  levelOptions,
  type LeagueDivision,
  type RatingScheme,
} from "@/lib/leagueFormats";
import { type LeagueDraft } from "@/lib/leagueDraft";

export {
  draftFormat,
  draftFromSeason,
  draftToColumns,
  emptyLeagueDraft,
  type LeagueDraft,
} from "@/lib/leagueDraft";

export const leagueInputCls =
  "w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:border-court-green";

// USTA league fields (all optional). Division drives the rating scheme
// (Mixed/55&O/Combo use combined pair-sum levels), which drives the level
// options; a manual scheme toggle stays available since section variants
// don't always follow the default.
export default function LeagueFields({
  draft,
  onChange,
}: {
  draft: LeagueDraft;
  onChange: (d: LeagueDraft) => void;
}) {
  const set = (patch: Partial<LeagueDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide pt-1">
        USTA league <span className="font-normal normal-case">(optional)</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={draft.division}
          onChange={(e) => {
            const division = e.target.value as "" | LeagueDivision;
            set({
              division,
              scheme: division ? defaultRatingScheme(division) : "straight",
              level: "",
            });
          }}
          className={leagueInputCls}
        >
          <option value="">Division</option>
          {DIVISION_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          value={draft.level}
          onChange={(e) => set({ level: e.target.value })}
          disabled={!draft.division}
          className={`${leagueInputCls} disabled:bg-gray-50 disabled:text-gray-400`}
        >
          <option value="">{draft.scheme === "combined" ? "Combined level" : "NTRP level"}</option>
          {levelOptions(draft.scheme).map((v) => (
            <option key={v} value={String(v)}>
              {v.toFixed(1)}
            </option>
          ))}
        </select>
      </div>
      {draft.division && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span>Level type:</span>
          {(["straight", "combined"] as RatingScheme[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => draft.scheme !== s && set({ scheme: s, level: "" })}
              className={`px-2 py-0.5 rounded-full border text-xs font-semibold ${
                draft.scheme === s
                  ? "border-court-green text-court-green bg-court-green-pale/30"
                  : "border-gray-200 text-gray-500 hover:border-gray-300"
              }`}
            >
              {s === "straight" ? "Individual" : "Combined"}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={draft.flight}
          onChange={(e) => set({ flight: e.target.value })}
          placeholder="Flight (e.g. 2)"
          maxLength={32}
          className={leagueInputCls}
        />
        <input
          type="text"
          value={draft.ustaTeamNumber}
          onChange={(e) => set({ ustaTeamNumber: e.target.value })}
          placeholder="USTA team # (10 digits)"
          inputMode="numeric"
          maxLength={16}
          className={leagueInputCls}
        />
      </div>
      <select
        value={draft.formatId}
        onChange={(e) => set({ formatId: e.target.value })}
        className={leagueInputCls}
      >
        <option value="">Lineup format</option>
        {LINEUP_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label} — {p.hint}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {draft.formatId === "custom" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-600">
            Singles courts
            <input
              type="number"
              min={0}
              max={6}
              value={draft.customSingles}
              onChange={(e) => set({ customSingles: Math.max(0, Math.min(6, Number(e.target.value) || 0)) })}
              className={`${leagueInputCls} mt-1`}
            />
          </label>
          <label className="text-xs text-gray-600">
            Doubles courts
            <input
              type="number"
              min={0}
              max={8}
              value={draft.customDoubles}
              onChange={(e) => set({ customDoubles: Math.max(0, Math.min(8, Number(e.target.value) || 0)) })}
              className={`${leagueInputCls} mt-1`}
            />
          </label>
        </div>
      )}
    </div>
  );
}
