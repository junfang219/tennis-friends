"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import OAuthButtons from "@/components/OAuthButtons";
import PhoneAuthForm from "@/components/PhoneAuthForm";

type Tab = "email" | "phone";

export default function RegisterPage() {
  const [tab, setTab] = useState<Tab>("email");
  const [form, setForm] = useState({
    name: "",
    handle: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error || "Registration failed");
      setLoading(false);
      return;
    }

    // Auto sign in
    const result = await signIn("credentials", {
      email: form.email,
      password: form.password,
      redirect: false,
    });

    if (result?.ok) {
      router.push("/onboarding");
      router.refresh();
    }
  };

  const update = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-ball-yellow/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 right-10 w-80 h-80 bg-court-green/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md animate-fade-in-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ball-yellow shadow-xl mb-4">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-court-green" fill="currentColor">
              <circle cx="12" cy="12" r="10" />
              <path d="M7 4.5c1.5 2 2.5 5 2.5 7.5s-1 5.5-2.5 7.5M17 4.5c-1.5 2-2.5 5-2.5 7.5s1 5.5 2.5 7.5" stroke="white" strokeWidth="1.2" fill="none" opacity="0.6"/>
            </svg>
          </div>
          <h1 className="font-display text-3xl font-bold text-court-green">
            Join the Club
          </h1>
          <p className="text-gray-500 mt-2 text-sm">Create your TennisFriends profile</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl shadow-court-green/5 border border-court-green-pale/20 p-8">
          <OAuthButtons callbackUrl="/onboarding" />

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-3 text-xs uppercase tracking-wider text-gray-400 bg-white font-semibold">or</span>
            </div>
          </div>

          <div className="flex bg-surface/70 rounded-xl p-1 mb-5">
            <button
              type="button"
              onClick={() => setTab("email")}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                tab === "email" ? "bg-white text-court-green shadow-sm" : "text-gray-500"
              }`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => setTab("phone")}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-colors ${
                tab === "phone" ? "bg-white text-court-green shadow-sm" : "text-gray-500"
              }`}
            >
              Phone
            </button>
          </div>

          {tab === "email" ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl border border-red-100">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50"
                  placeholder="Roger Federer"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Handle</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                  <input
                    type="text"
                    value={form.handle}
                    onChange={(e) => update("handle", e.target.value.replace(/^@+/, ""))}
                    className="w-full pl-7 pr-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50"
                    placeholder="your_handle"
                    required
                    minLength={3}
                    maxLength={20}
                  />
                </div>
                <p className="text-[11px] text-gray-400 mt-1">3–20 characters: letters, numbers, dot, underscore.</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50"
                  placeholder="your@email.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50"
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-base mt-2"
              >
                {loading ? (
                  <svg className="animate-spin w-5 h-5 mx-auto" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : (
                  "Create Account"
                )}
              </button>
            </form>
          ) : (
            <PhoneAuthForm callbackUrl="/onboarding" />
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              Already a member?{" "}
              <Link href="/login" className="font-semibold text-court-green hover:text-court-green-light transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
