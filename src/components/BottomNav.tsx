"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";

export default function BottomNav() {
  const { status } = useSession();
  const pathname = usePathname();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(!!(window as unknown as { Capacitor?: unknown }).Capacitor);
  }, []);

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + "/");

  // Fetch unread message count
  useEffect(() => {
    if (status !== "authenticated" || !isNative) return;
    const fetchUnread = () => {
      fetch("/api/inbox")
        .then((r) => r.ok ? r.json() : [])
        .then((data: { unreadCount?: number }[]) => {
          const total = Array.isArray(data)
            ? data.reduce((sum: number, c: { unreadCount?: number }) => sum + (c.unreadCount || 0), 0)
            : 0;
          setUnreadMessages(total);
        })
        .catch(() => {});
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [status, isNative]);

  // Add bottom padding to body so content isn't hidden behind the nav
  useEffect(() => {
    if (status !== "authenticated" || !isNative) return;
    document.body.style.paddingBottom = "5rem";
    return () => { document.body.style.paddingBottom = ""; };
  }, [status, isNative]);

  // All hooks above — safe to return early now
  if (status !== "authenticated" || !isNative) return null;

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
      label: "Teams",
      active: isActive("/groups"),
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
          <path d="M4 22h16" />
          <path d="M18 2H6v7a6 6 0 0012 0V2z" />
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
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex flex-col items-center justify-center flex-1 h-full relative transition-colors ${
              tab.active
                ? "text-court-green"
                : "text-gray-400 active:text-gray-600"
            }`}
          >
            <div className="relative">
              {tab.icon(tab.active)}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
                  {tab.badge > 99 ? "99+" : tab.badge}
                </span>
              )}
            </div>
            <span className={`text-[10px] mt-0.5 ${tab.active ? "font-semibold" : "font-medium"}`}>
              {tab.label}
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
