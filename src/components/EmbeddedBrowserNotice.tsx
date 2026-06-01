"use client";

import { useState } from "react";

// Shown on /login and /register when we detect the page is loaded inside an
// embedded in-app browser (Instagram, Facebook, etc.). Google's "Use secure
// browsers" policy blocks OAuth in these UAs (Error 403:
// disallowed_useragent), so we hide the Google button and tell the user how
// to escape — open the link in Safari, or sign up with email.
export function EmbeddedBrowserNotice({ appName }: { appName: string }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail in some embedded browsers — fall back to a
      // selection prompt so the user can still grab the URL.
      window.prompt("Copy this link:", window.location.href);
    }
  }

  return (
    <div
      role="alert"
      className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      <p className="font-semibold">Google sign-in won&apos;t work here</p>
      <p className="mt-1">
        You opened this from inside {appName}. Google blocks sign-in in
        embedded browsers.
      </p>
      <ul className="mt-2 list-disc pl-5 space-y-1">
        <li>
          Tap the <span aria-hidden>⋯</span> menu and choose{" "}
          <strong>Open in Safari</strong> (or Chrome), then sign in there.
        </li>
        <li>Or sign up with email below — that works everywhere.</li>
      </ul>
      <button
        type="button"
        onClick={copyLink}
        className="mt-3 inline-flex items-center rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
      >
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
    </div>
  );
}
