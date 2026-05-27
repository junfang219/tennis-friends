"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listUpcomingFindPlayersGames } from "@/lib/supabase/queries";
import { resolveFacilityByName } from "@/lib/facilities";
import { distanceMeters } from "@/lib/haversine";

// Restored arrival prompt — opens the report-empty-courts modal when
// the user is within 120m of the venue of a find_players game they're
// part of, within the 30-min-before-to-end window. Originally lived at
// src/lib/useArrivalDetection.ts; deleted in the burn-down (86f26a5)
// because it called /api/games/upcoming. Re-implemented against the
// new listUpcomingFindPlayersGames query.

export type ArrivalPrompt = {
  postId: string;
  courtId: string;
  venueName: string;
};

type ResolvedGame = {
  postId: string;
  startTime: number;
  endTime: number;
  courtId: string;
  venueName: string;
  venueLat: number;
  venueLng: number;
};

const ELIGIBLE_CATEGORIES = new Set(["public_park", "school", "college"]);
const GAMES_POLL_MS = 3 * 60 * 1000;
const LOCATION_POLL_MS = 90 * 1000;
const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const ARRIVAL_RADIUS_M = 120;
const PROMPT_FLAG_PREFIX = "arrivalPrompted:";

function promptFlag(postId: string): string {
  return `${PROMPT_FLAG_PREFIX}${postId}`;
}

function alreadyPrompted(postId: string): boolean {
  try {
    return localStorage.getItem(promptFlag(postId)) !== null;
  } catch {
    return false;
  }
}

function markPrompted(postId: string): void {
  try {
    localStorage.setItem(promptFlag(postId), String(Date.now()));
  } catch {
    /* ignore */
  }
}

function getCurrentPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 }
    );
  });
}

function inWindow(game: ResolvedGame, now: number): boolean {
  return now >= game.startTime - WINDOW_BEFORE_MS && now <= game.endTime;
}

export function useArrivalDetection(): {
  prompt: ArrivalPrompt | null;
  dismiss: () => void;
} {
  const { status } = useSession();
  const [prompt, setPrompt] = useState<ArrivalPrompt | null>(null);
  const gamesRef = useRef<ResolvedGame[]>([]);
  const checkingRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function refreshGames() {
      try {
        const supabase = createSupabaseBrowserClient();
        const rows = await listUpcomingFindPlayersGames(supabase);
        if (cancelled) return;
        const resolved: ResolvedGame[] = [];
        for (const r of rows) {
          if (!r.courtLocation.trim()) continue;
          const facility = resolveFacilityByName(r.courtLocation);
          if (!facility) continue;
          if (!ELIGIBLE_CATEGORIES.has(facility.category)) continue;
          if (facility.latitude == null || facility.longitude == null) continue;
          const start = new Date(`${r.playDate}T${r.playTime}:00`).getTime();
          if (!Number.isFinite(start)) continue;
          const end = start + (r.playDuration || 90) * 60_000;
          resolved.push({
            postId: r.postId,
            startTime: start,
            endTime: end,
            courtId: facility.courtId,
            venueName: facility.name,
            venueLat: facility.latitude,
            venueLng: facility.longitude,
          });
        }
        gamesRef.current = resolved;
      } catch {
        /* swallow — the next poll will retry */
      }
    }

    async function checkLocation() {
      if (checkingRef.current) return;
      const now = Date.now();
      const candidates = gamesRef.current.filter(
        (g) => inWindow(g, now) && !alreadyPrompted(g.postId)
      );
      if (candidates.length === 0) return;
      checkingRef.current = true;
      try {
        const pos = await getCurrentPosition();
        if (!pos || cancelled) return;
        for (const game of candidates) {
          const d = distanceMeters(
            pos.coords.latitude,
            pos.coords.longitude,
            game.venueLat,
            game.venueLng
          );
          if (d <= ARRIVAL_RADIUS_M) {
            markPrompted(game.postId);
            setPrompt({
              postId: game.postId,
              courtId: game.courtId,
              venueName: game.venueName,
            });
            break;
          }
        }
      } finally {
        checkingRef.current = false;
      }
    }

    void refreshGames().then(() => {
      if (!cancelled) void checkLocation();
    });
    const gamesInterval = setInterval(() => void refreshGames(), GAMES_POLL_MS);
    const locInterval = setInterval(() => void checkLocation(), LOCATION_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(gamesInterval);
      clearInterval(locInterval);
    };
  }, [status]);

  return {
    prompt,
    dismiss: () => setPrompt(null),
  };
}
