// Same instant skeleton as the 1:1 thread — see
// src/app/chat/[userId]/loading.tsx for the rationale.
export default function GroupChatLoading() {
  return (
    <div className="max-w-2xl mx-auto flex flex-col" style={{ height: "calc(100dvh - 4rem)" }}>
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-gray-100" />
        <div className="skeleton w-10 h-10 rounded-full" />
        <div className="space-y-1.5 flex-1">
          <div className="skeleton w-32 h-4" />
          <div className="skeleton w-20 h-3" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 bg-surface/50 net-texture" />

      <div className="bg-white border-t border-gray-200 px-4 py-3 shrink-0">
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
