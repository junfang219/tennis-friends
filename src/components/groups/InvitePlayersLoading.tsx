import TeamSetupProgress from "./TeamSetupProgress";

export default function InvitePlayersLoading({ setup = false }: { setup?: boolean }) {
  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 py-6">
      <h1 className="font-display text-3xl font-bold text-court-green">Invite players</h1>
      {setup && <TeamSetupProgress step={2} />}
      <p role="status" className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-700">
        Loading invitation options…
      </p>
    </div>
  );
}
