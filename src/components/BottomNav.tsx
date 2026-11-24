"use client";

import Link from "next/link";
import { useIsNative } from "@/hooks/useIsNative";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/lib/supabase/nextauth-compat";
import { useEffect, useState, useTransition } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { inboxCacheKey, loadInbox } from "@/lib/inboxLoader";
import { useCachedQuery } from "@/lib/useCachedQuery";

const NATIVE_TAB_BAR_HEIGHT = "calc(3.5rem + 1px + env(safe-area-inset-bottom, 0px))";

export default function BottomNav() {
  const { status, data: session } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const isNative = useIsNative();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [isNavigating, startTransition] = useTransition();
  const userId = session?.user.id;
  const { data: inbox, refetch: refetchInbox } = useCachedQuery(
    isNative ? inboxCacheKey(userId) : null,
    () => loadInbox(createSupabaseBrowserClient(), userId),
  );
  const unreadMessages = (inbox ?? []).reduce(
    (total, item) => total + (item.type === "group" || item.muted ? 0 : item.unreadCount),
    0,
  );

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");
  const activePendingHref = isNavigating && pendingHref !== pathname ? pendingHref : null;

  // The inbox tab and unread badge share the same account-scoped data.
  useEffect(() => {
    if (!isNative || !userId) return;
    const interval = setInterval(() => {
      if (!document.hidden) void refetchInbox();
    }, 30_000);
    return () => clearInterval(interval);
  }, [isNative, userId, refetchInbox]);

  // Thread pages mark messages read after mounting.
  useEffect(() => {
    if (!isNative || !userId || !pathname.startsWith("/chat/")) return;
    const timer = setTimeout(() => { void refetchInbox(); }, 500);
    return () => clearTimeout(timer);
  }, [pathname, isNative, userId, refetchInbox]);

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

  // Reserve the tab bar's height in the page layout —
  // but only when the nav is actually rendered. On chat threads the nav
  // is hidden and the extra padding would just open a dead gap under
  // the chat container.
  useEffect(() => {
    if (status !== "authenticated" || !isNative || isChatThread || isCourtDetail) return;
    const style = document.body.style;
    style.setProperty("--native-tab-bar-height", NATIVE_TAB_BAR_HEIGHT);
    return () => {
      style.removeProperty("--native-tab-bar-height");
    };
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
      active: isActive("/courts") || pathname === "/bookings",
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
    <nav aria-label="App tabs" className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]" style={{ zIndex: 9999 }}>
      {activePendingHref && (
        <span role="status" className="sr-only">
          Opening {tabs.find((tab) => tab.href === activePendingHref)?.label}
        </span>
      )}
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
              aria-current={tab.active ? "page" : undefined}
              onNavigate={(event) => {
                event.preventDefault();
                if (tab.href === pathname && !isNavigating) return;
                setPendingHref(tab.href);
                startTransition(() => router.push(tab.href));
              }}
              style={{
                // Disable the 300 ms tap-delay heuristic and the gray
                // tap-highlight flash that WKWebView paints over custom
                // controls.
                touchAction: "manipulation",
                WebkitTapHighlightColor: "transparent",
              }}
              className={`flex flex-col items-center justify-center flex-1 h-full relative transition-colors active:bg-court-green/10 select-none ${
                visuallyActive ? "text-court-green" : "text-gray-600"
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
