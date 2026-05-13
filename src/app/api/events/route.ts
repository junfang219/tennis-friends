import { auth } from "@/lib/session";
import { subscribe, type AppEvent } from "@/lib/eventBus";

export const dynamic = "force-dynamic";
// Disable Next.js / Vercel Edge wrapping that buffers responses.
export const runtime = "nodejs";

const KEEPALIVE_MS = 25_000;

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  let unsubscribe: (() => void) | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (event: AppEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const ping = () => {
        if (closed) return;
        try {
          // SSE comment lines (start with ":") double as keep-alive pings.
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (pingTimer) clearInterval(pingTimer);
        if (unsubscribe) unsubscribe();
        try { controller.close(); } catch {}
      };

      // Initial hello so clients know the connection is live.
      send({ kind: "hello" });

      pingTimer = setInterval(ping, KEEPALIVE_MS);
      unsubscribe = subscribe(userId, send);

      // Browser navigation away triggers AbortSignal on the request.
      request.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      if (pingTimer) clearInterval(pingTimer);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering (e.g., nginx) so events flush immediately.
      "X-Accel-Buffering": "no",
    },
  });
}
