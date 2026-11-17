"use client";
import CreateTeamForm from "./CreateTeamForm";
import { useTeamManagement } from "./useTeamManagement";
/** Isolated review server only; production details are loaded by the server page. */
export default function SetupDetailsPreview({ groupId }: { groupId: string }) {
  const { state, error } = useTeamManagement(groupId);
  if (error) return <p role="alert">{error}</p>;
  if (!state) return <p role="status">Loading team details…</p>;
  return <CreateTeamForm groupId={groupId} initialDetails={{ name: state.config.name, description: state.config.description ?? "" }} />;
}
