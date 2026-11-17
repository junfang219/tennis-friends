"use client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { teamManagementStateSchema, type TeamManagementState, type teamManagementMutationSchema } from "@/lib/onboarding/management";
export async function teamResponse(response: Response): Promise<unknown> {
  const raw: unknown = await response.json();
  if (!response.ok) { const error = z.object({ error: z.string() }).safeParse(raw); throw new Error(error.success ? error.data.error : "Could not complete this action"); }
  return raw;
}
export function useTeamManagement(groupId: string) {
  const [state, setState] = useState<TeamManagementState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const next = teamManagementStateSchema.parse(await teamResponse(await fetch(`/api/team-onboarding/${groupId}`, { cache: "no-store" })));
    setState(next); setError(""); return next;
  }, [groupId]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/team-onboarding/${groupId}`, { cache: "no-store" }).then(teamResponse).then(raw => { const next = teamManagementStateSchema.parse(raw); if (active) { setState(next); setError(""); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : "Could not load team"); });
    return () => { active = false; };
  }, [groupId]);
  async function mutate(change: z.infer<typeof teamManagementMutationSchema>) {
    await teamResponse(await fetch(`/api/team-onboarding/${groupId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) }));
    return load();
  }
  return { state, error, load, mutate };
}
