import Link from "next/link";

export default function ExpiredFriendGroupLinkPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="rounded-3xl border border-court-green-pale/20 bg-white p-8 text-center shadow-sm">
        <h1 className="font-display text-2xl font-bold text-gray-900">This group link is no longer active</h1>
        <p className="mt-3 text-sm text-gray-600">Ask the group owner or a member with permission to add you.</p>
        <Link href="/friends" className="btn-primary mt-5 inline-block">Go to Friends</Link>
      </div>
    </div>
  );
}
