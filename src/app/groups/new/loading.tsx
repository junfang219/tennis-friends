import TeamSetupProgress from "@/components/groups/TeamSetupProgress";

export default function NewTeamLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 py-8" aria-busy="true">
      <h1 className="font-display text-3xl font-bold text-court-green">Create your team</h1>
      <TeamSetupProgress step={1} />
      <div role="status" className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
        Loading team setup…
      </div>
    </div>
  );
}
