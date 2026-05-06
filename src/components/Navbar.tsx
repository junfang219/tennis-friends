"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import Avatar from "./Avatar";
import NotificationBell from "./NotificationBell";
import MessageBell from "./MessageBell";

export default function Navbar() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(!!(window as unknown as { Capacitor?: unknown }).Capacitor);
  }, []);

  const isActive = (path: string) => pathname === path;

  const navLinks = [
    { href: "/", label: "Feed", icon: FeedIcon },
    { href: "/friends", label: "Friends", icon: FriendsIcon },
    { href: "/groups", label: "Teams", icon: GroupsIcon },
    { href: "/courts", label: "Courts", icon: CourtsIcon },
    { href: "/calendar", label: "Calendar", icon: CalendarIcon },
    { href: "/search", label: "Discover", icon: SearchIcon },
  ];

  // Warm up all top-nav routes once the user is authenticated, so clicking any tab feels instant.
  useEffect(() => {
    if (status !== "authenticated") return;
    navLinks.forEach((link) => router.prefetch(link.href));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <nav className="sticky top-0 z-40 bg-court-green court-pattern border-b border-white/10 pt-[env(safe-area-inset-top)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo — tapping refreshes feed and shows all content */}
          <button
            onClick={() => {
              if (pathname === "/") {
                window.scrollTo({ top: 0, behavior: "smooth" });
                window.location.reload();
              } else {
                router.push("/");
              }
            }}
            className="flex items-center gap-2.5 group"
          >
            <div className="w-9 h-9 rounded-full bg-ball-yellow flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-court-green" fill="currentColor">
                <circle cx="12" cy="12" r="10" fill="currentColor" />
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="currentColor" opacity="0.9"/>
                <path d="M7 4.5c1.5 2 2.5 5 2.5 7.5s-1 5.5-2.5 7.5M17 4.5c-1.5 2-2.5 5-2.5 7.5s1 5.5 2.5 7.5" stroke="white" strokeWidth="1.2" fill="none" opacity="0.6"/>
              </svg>
            </div>
            <span className="font-display text-xl font-bold text-white tracking-tight hidden sm:block">
              Tennis<span className="text-ball-yellow">Friends</span>
            </span>
          </button>

          {/* Desktop Nav */}
          {status === "authenticated" && (
            <div className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  prefetch={true}
                  onMouseEnter={() => router.prefetch(link.href)}
                  onFocus={() => router.prefetch(link.href)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    isActive(link.href)
                      ? "bg-white/15 text-ball-yellow"
                      : "text-white/70 hover:text-white hover:bg-white/8"
                  }`}
                >
                  <link.icon active={isActive(link.href)} />
                  {link.label}
                </Link>
              ))}
            </div>
          )}

          {/* Right side */}
          <div className="flex items-center gap-3">
            {status === "authenticated" && session?.user ? (
              <div className="flex items-center gap-3">
                {!isNative && <MessageBell />}
                {!isNative && <NotificationBell />}
                <Link href="/profile" className="hidden sm:flex items-center group">
                  <Avatar name={session.user.name || ""} image={session.user.image} size="sm" />
                </Link>
              </div>
            ) : status === "unauthenticated" ? (
              <div className="flex items-center gap-2">
                <Link href="/login" className="text-sm font-medium text-white/80 hover:text-white px-4 py-2 rounded-xl transition-colors">
                  Sign in
                </Link>
                <Link href="/register" className="text-sm font-semibold bg-ball-yellow text-court-green px-4 py-2 rounded-xl hover:bg-ball-glow transition-all hover:shadow-lg">
                  Join the club
                </Link>
              </div>
            ) : null}

            {/* Mobile menu button */}
            {status === "authenticated" && (
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="md:hidden text-white/70 hover:text-white p-2"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                  {mobileOpen ? (
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  ) : (
                    <path fillRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                  )}
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && status === "authenticated" && (
          <div className="md:hidden pb-4 border-t border-white/10 mt-2 pt-3">
            {/* On iOS native, hide Feed/Teams/Courts (they're in bottom nav) and add Notifications */}
            {(isNative
              ? navLinks.filter((l) => l.href !== "/" && l.href !== "/groups" && l.href !== "/courts")
              : navLinks
            ).map((link) => (
              <Link
                key={link.href}
                href={link.href}
                prefetch={true}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive(link.href)
                    ? "bg-white/15 text-ball-yellow"
                    : "text-white/70 hover:text-white hover:bg-white/8"
                }`}
              >
                <link.icon active={isActive(link.href)} />
                {link.label}
              </Link>
            ))}
            {isNative && (
              <Link
                href="/notifications"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive("/notifications")
                    ? "bg-white/15 text-ball-yellow"
                    : "text-white/70 hover:text-white hover:bg-white/8"
                }`}
              >
                <NotificationIcon active={isActive("/notifications")} />
                Notifications
              </Link>
            )}
            {isNative && (
              <button
                onClick={() => { setMobileOpen(false); signOut({ callbackUrl: "/login" }); }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white/70 hover:text-white hover:bg-white/8 transition-all w-full text-left"
              >
                <SignOutIcon />
                Sign out
              </button>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

function FeedIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function FriendsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function GroupsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0012 0V2z" />
    </svg>
  );
}

function CalendarIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function SearchIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function CourtsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function NotificationIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <polyline points="16,17 21,12 16,7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
