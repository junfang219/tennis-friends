// Instant skeleton shown by Next.js (via its Suspense boundary) while
// the chat thread bundle downloads + the component does its first render.
// Mirrors the loaded page's layout (fixed inset-0, absolutely positioned
// input bar) so the user sees the chat shell — most importantly the
// "Type a message..." input — within one frame of tapping a conversation,
// instead of staring at a blank page for the route-load duration
// (noticeable over LAN to a physical iPhone).
export default function ChatLoading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      {/* Header */}
      <div
        className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}
      >
        <div className="w-7 h-7 rounded-lg bg-gray-100" />
        <div className="skeleton w-10 h-10 rounded-full" />
        <div className="space-y-1.5 flex-1">
          <div className="skeleton w-32 h-4" />
          <div className="skeleton w-20 h-3" />
        </div>
      </div>

      {/* Messages — empty body so nothing shifts when content arrives */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 bg-surface/50 net-texture" />

      {/* Input — the part the user is waiting for. Disabled stand-in;
          the live component takes over once mounted. */}
      <div
        className="absolute left-0 right-0 bg-white border-t border-gray-200 px-4 py-3"
        style={{ bottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
          <div className="flex-1 px-4 py-2.5 border border-gray-200 rounded-full text-sm bg-surface/50 text-gray-400">
            Type a message…
          </div>
          <div className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
          <div className="w-10 h-10 rounded-full bg-gray-100 shrink-0" />
        </div>
      </div>
    </div>
  );
}
