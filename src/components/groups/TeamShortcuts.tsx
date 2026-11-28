"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const shortcuts = [
  {
    path: "calendar",
    label: "Schedule",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18M8 14h2m4 0h2m-8 4h2m4 0h2" />
      </>
    ),
  },
  {
    path: "chat",
    label: "Chat",
    icon: <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
  },
  {
    path: "availability",
    label: "Matches",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
  },
  {
    path: "practice",
    label: "Practice",
    icon: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  },
  {
    path: "albums",
    label: "Albums",
    icon: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="m21 15-5-5L5 21" />
      </>
    ),
  },
  {
    path: "files",
    label: "Files",
    icon: (
      <>
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6m-4 5H8m8 4H8m2-8H8" />
      </>
    ),
  },
  {
    path: "scouting",
    label: "Scouting",
    icon: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></>,
  },
  {
    path: "expenses",
    label: "Expenses",
    icon: <path d="M12 1v22m5-18H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />,
  },
] as const;

const phoneShortcuts = shortcuts.filter(({ path }) => path === "chat" || path === "availability");
const moreShortcuts = shortcuts.filter((shortcut) => !phoneShortcuts.some(({ path }) => path === shortcut.path));
const shortcutClass = "btn-secondary flex items-center justify-center gap-1.5";

function ShortcutIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

export default function TeamShortcuts({ groupId }: { groupId: string }) {
  const groupHref = `/groups/${groupId}`;
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const phoneNav = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    menu.current?.scrollIntoView({ block: "nearest" });
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !phoneNav.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <>
      <nav aria-label="Team shortcuts" className="mt-4 hidden grid-cols-4 gap-2 sm:grid">
        {shortcuts.map(({ path, label, icon }) => (
          <Link key={path} href={`${groupHref}/${path}`} className={shortcutClass}>
            <ShortcutIcon>{icon}</ShortcutIcon>
            {label}
          </Link>
        ))}
      </nav>
      <nav
        ref={phoneNav}
        aria-label="Team shortcuts"
        className="relative mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-1.5 sm:hidden"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }}
        onBlur={(event) => {
          if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        {phoneShortcuts.map(({ path, label, icon }) => (
          <Link
            key={path}
            href={`${groupHref}/${path}`}
            className={`${shortcutClass} min-h-11 !gap-1 !px-1 !text-[13px]`}
            onNavigate={() => setOpen(false)}
          >
            <ShortcutIcon>{icon}</ShortcutIcon>
            {label}
          </Link>
        ))}
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-gray-200 bg-white px-2 text-[13px] font-semibold text-court-green hover:bg-surface aria-expanded:bg-surface"
          onClick={() => setOpen((current) => !current)}
        >
          More
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={open ? "rotate-180" : undefined}
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
        <ul
          ref={menu}
          id={menuId}
          aria-label="More team shortcuts"
          className={`${open ? "grid" : "hidden"} absolute right-0 top-full z-20 mt-1.5 w-full max-w-[16.25rem] scroll-mb-[calc(var(--native-tab-bar-height,0px)+0.5rem)] grid-cols-2 gap-x-1 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg`}
        >
          {moreShortcuts.map(({ path, label, icon }) => (
            <li key={path} className="[&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-gray-100">
              <Link
                href={`${groupHref}/${path}`}
                className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[13px] font-semibold text-court-green hover:bg-surface"
                onNavigate={() => setOpen(false)}
              >
                <ShortcutIcon>{icon}</ShortcutIcon>
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
