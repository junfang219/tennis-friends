"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { useEffect, useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listDmThreads, listMyTeamThreads } from "@/lib/supabase/queries";

const TAB_ROUTES = ["/", "/groups", "/courts", "/chat", "/profile"] as const;

export default function BottomNav() {
  const { status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isNative, setIsNative] = useState(false);
  // Optimistic active tab: set on pointerdown so the tap visibly responds
  // before the route swap + page render + Supabase fetches complete. The
  // WKWebView is unreliable about flashing Tailwind's `active:` pseudo on
  // tap, so we drive the feedback in JS instead. Cleared once the real
  // pathname catches up (or the gesture is cancelled).
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    // `window.Capacitor` is populated even on the web (the @capacitor/core
    // module assigns a stub when imported, which PushRegistrar pulls in for
    // its native-detection check). Use `isNativePlatform()` — it returns
    // false in the browser and true only inside the iOS/Android shell.
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    setIsNative(!!cap?.isNativePlatform?.());
  }, []);

  // Warm the client-side route cache for every tab once we're logged in, so
  // tab taps render from cache instead of waiting on a fresh fetch. The
  // built-in <Link> prefetch is unreliable inside the Capacitor WebView, so
  // we trigger it imperatively.
  useEffect(() => {
    if (status !== "authenticated") return;
    for (const route of TAB_ROUTES) {
      router.prefetch(route);
    }
  }, [status, router]);

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  // Treat pendingHref as cleared once the router has actually landed on it
  // (or onto a deeper route under it). Derived in render so we don't need
  // a clear-on-pathname-change effect — the stale state just stops being
  // read and gets overwritten by the next tap.
  const activePendingHref =
    pendingHref && !(pathname === pendingHref || pathname.startsWith(pendingHref + "/"))
      ? pendingHref
      : null;

  const handleTabTap = (href: string) => {
    if (pathname === href) {
      // Already at the tab root — no nav.
      return;
    }
    // On a deeper page within this tab's section (e.g. /groups/[id]), tapping
    // the tab pops back to its root list rather than no-opping. Falls through
    // to router.push(href).
    setPendingHref(href);
    // startTransition keeps the bottom-nav (and the rest of the previous
    // page) interactive while React renders the new route, so the active
    // chip's color swap isn't blocked by the new page's mount work.
    startTransition(() => router.push(href));
  };

  const fetchUnread = () => {
    const supabase = createSupabaseBrowserClient();
    // Sum DM + team-chat unreads. Session chats currently report 0 unread
    // so they don't contribute. Muted teams are excluded — they're meant
    // not to pull attention to the badge.
    Promise.all([listDmThreads(supabase), listMyTeamThreads(supabase)])
      .then(([dms, teams]) => {
        const dmUnread = dms.reduce((sum, t) => sum + t.unread_count, 0);
        const teamUnread = teams.reduce(
          (sum, t) => sum + (t.muted ? 0 : t.unread_count),
          0
        );
        setUnreadMessages(dmUnread + teamUnread);
      })
      .catch(() => {});
  };

  // Fetch unread message count
  useEffect(() => {
    if (status !== "authenticated" || !isNative) return;
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [status, isNative]);

  // Re-fetch when entering a chat route. The chat page marks messages read on
  // mount, so refetching shortly after lets the tab badge update without
  // waiting for the 30s poll.
  useEffect(() => {
    if (status !== "authenticated" || !isNative) return;
    if (!pathname.startsWith("/chat")) return;
    const t = setTimeout(fetchUnread, 500);
    return () => clearTimeout(t);
  }, [pathname, status, isNative]);

  // Hide on individual chat threads (1:1 and group). The chat is a
  // dedicated typing surface — the bottom tab strip squeezes the input
  // away from the keyboard and adds a visible gap on iOS. The inbox at
  // /chat itself keeps the nav so tab-switching still works there.
  // /groups/[id]/chat is the team group chat — same focused-thread UX
  // as the DM and session chats, so it gets the same treatment. Before
  // this match the body's 5rem padding-bottom plus the chat
  // container's fixed-height calc made the page scrollable, and the
  // sticky global navbar (z-40) ended up covering the chat header
  // (see iPhone 17 screenshot, 2026-05-28).
  const isChatThread =
    (pathname.startsWith("/chat/") && pathname !== "/chat") ||
    pathname.startsWith("/chat/group/") ||
    /^\/groups\/[^/]+\/chat(?:\/|$)/.test(pathname);

  // Court detail page: reclaim the bottom strip so the Power BI
  // availability modal (which goes full-bleed in landscape) and the
  // detail content itself get the extra ~80px. Users navigate back to
  // /courts via the page's own back button. List view at /courts
  // itself keeps the nav.
  const isCourtDetail = /^\/courts\/[^/]+/.test(pathname);

  // Add bottom padding to body so content isn't hidden behind the nav —
  // but only when the nav is actually rendered. On chat threads the nav
  // is hidden and the extra padding would just open a dead gap under
  // the chat container.
  useEffect(() => {
    if (status !== "authenticated" || !isNative || isChatThread || isCourtDetail) return;
    document.body.style.paddingBottom = "5rem";
    return () => { document.body.style.paddingBottom = ""; };
  }, [status, isNative, isChatThread, isCourtDetail]);

  // All hooks above — safe to return early now
  if (status !== "authenticated" || !isNative) return null;
  if (isChatThread || isCourtDetail) return null;

  const tabs = [
    {
      href: "/",
      label: "Feed",
      active: pathname === "/",
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      ),
    },
    {
      href: "/groups",
      label: "Communities",
      active: isActive("/groups") || isActive("/events"),
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="7" cy="6.5" rx="3" ry="4" transform="rotate(-25 7 6.5)" />
          <line x1="9" y1="9.5" x2="17" y2="21.5" />
          <ellipse cx="17" cy="6.5" rx="3" ry="4" transform="rotate(25 17 6.5)" />
          <line x1="15" y1="9.5" x2="7" y2="21.5" />
        </svg>
      ),
    },
    {
      href: "/courts",
      label: "Courts",
      active: isActive("/courts"),
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      ),
    },
    {
      href: "/chat",
      label: "Messages",
      active: isActive("/chat"),
      badge: unreadMessages,
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      ),
    },
    {
      href: "/profile",
      label: "Profile",
      active: isActive("/profile"),
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      ),
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]" style={{ zIndex: 9999 }}>
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          // While a tab is pending navigation, treat *that* tab as active
          // instead of whatever the real pathname still reports. Gives an
          // instant visual ack to the tap, regardless of how long the new
          // page takes to mount + fetch.
          const visuallyActive = activePendingHref ? tab.href === activePendingHref : tab.active;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              prefetch
              onPointerDown={() => {
                if (tab.href !== pathname && !pathname.startsWith(tab.href + "/")) {
                  setPendingHref(tab.href);
                }
              }}
              onPointerCancel={() => setPendingHref((p) => (p === tab.href ? null : p))}
              onPointerLeave={() => setPendingHref((p) => (p === tab.href ? null : p))}
              onClick={(e) => {
                // Take over from <Link>'s default navigation so we can wrap
                // the push in startTransition (keeps the nav interactive
                // while React renders the new route).
                e.preventDefault();
                handleTabTap(tab.href);
              }}
              style={{
                // Disable the 300 ms tap-delay heuristic and the gray
                // tap-highlight flash that WKWebView paints over custom
                // controls.
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
              className={`flex flex-col items-center justify-center flex-1 h-full relative transition-colors select-none ${
                visuallyActive ? "text-court-green" : "text-gray-400"
              }`}
            >
              <div className="relative">
                {tab.icon(visuallyActive)}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
                    {tab.badge > 99 ? "99+" : tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-0.5 ${visuallyActive ? "font-semibold" : "font-medium"}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
