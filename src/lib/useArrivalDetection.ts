"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { distanceMeters } from "@/lib/haversine";

export type UpcomingGame = {
  postId: string;
  startTime: string;
  endTime: string;
  courtId: string;
  venueName: string;
  venueLat: number;
  venueLng: number;
};

export type ArrivalPrompt = {
  postId: string;
  courtId: string;
  venueName: string;
};

const BOOKINGS_POLL_MS = 3 * 60 * 1000;
const LOCATION_POLL_MS = 90 * 1000;
const WINDOW_BEFORE_MS = 30 * 60 * 1000;
const ARRIVAL_RADIUS_M = 120;
const PROMPT_FLAG_PREFIX = "arrivalPrompted:";

function promptFlag(postId: string): string {
  return `${PROMPT_FLAG_PREFIX}${postId}`;
}

function isInWindow(game: UpcomingGame, now: number): boolean {
  const start = new Date(game.startTime).getTime();
  const end = new Date(game.endTime).getTime();
  return now >= start - WINDOW_BEFORE_MS && now <= end;
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

export function useArrivalDetection(): {
  prompt: ArrivalPrompt | null;
  dismiss: () => void;
} {
  const { status } = useSession();
  const [prompt, setPrompt] = useState<ArrivalPrompt | null>(null);
  const gamesRef = useRef<UpcomingGame[]>([]);
  const checkingRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;

    async function fetchGames() {
      try {
        const res = await fetch("/api/games/upcoming", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { games?: UpcomingGame[] };
        if (cancelled) return;
        gamesRef.current = Array.isArray(data.games) ? data.games : [];
      } catch {
        /* ignore */
      }
    }

    async function checkLocation() {
      if (checkingRef.current) return;
      const now = Date.now();
      const candidates = gamesRef.current.filter(
        (g) => isInWindow(g, now) && !alreadyPrompted(g.postId)
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

    fetchGames();
    checkLocation();
    const gamesInterval = setInterval(fetchGames, BOOKINGS_POLL_MS);
    const locInterval = setInterval(checkLocation, LOCATION_POLL_MS);
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
