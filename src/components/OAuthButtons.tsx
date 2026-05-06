"use client";

import { signIn } from "next-auth/react";

type Props = {
  callbackUrl?: string;
  providers?: { google?: boolean; apple?: boolean };
};

export default function OAuthButtons({
  callbackUrl = "/onboarding",
  providers = { google: true, apple: true },
}: Props) {
  if (!providers.google && !providers.apple) return null;

  return (
    <div className="space-y-2.5">
      {providers.google && (
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl })}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-200 rounded-xl text-sm font-semibold text-gray-800 bg-white hover:bg-gray-50 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" fill="#4285F4" />
            <path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 009 18z" fill="#34A853" />
            <path d="M3.96 10.71A5.41 5.41 0 013.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l3-2.33z" fill="#FBBC05" />
            <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 009 0 9 9 0 00.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" fill="#EA4335" />
          </svg>
          Continue with Google
        </button>
      )}
      {providers.apple && (
        <button
          type="button"
          onClick={() => signIn("apple", { callbackUrl })}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-900 rounded-xl text-sm font-semibold text-white bg-gray-900 hover:bg-gray-800 transition-colors"
        >
          <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true" fill="currentColor">
            <path d="M13.26 9.56a4.03 4.03 0 012.08-3.5 4.2 4.2 0 00-3.3-1.73c-1.4-.14-2.73.82-3.44.82-.72 0-1.8-.8-2.97-.78A4.41 4.41 0 001.9 6.6c-1.6 2.76-.41 6.84 1.13 9.1.75 1.1 1.64 2.35 2.8 2.3 1.13-.04 1.56-.74 2.93-.74 1.36 0 1.74.74 2.94.72 1.22-.02 1.99-1.12 2.73-2.24.5-.72.88-1.51 1.13-2.34a3.92 3.92 0 01-2.3-3.84zM10.88 2.93A3.9 3.9 0 0011.8 0a4 4 0 00-2.6 1.34 3.72 3.72 0 00-.94 2.83 3.3 3.3 0 002.62-1.24z" />
          </svg>
          Continue with Apple
        </button>
      )}
    </div>
  );
}
