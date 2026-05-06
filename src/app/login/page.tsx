"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import OAuthButtons from "@/components/OAuthButtons";
import PhoneAuthForm from "@/components/PhoneAuthForm";

type Tab = "email" | "phone";

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password. Game, set, try again!");
      setLoading(false);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      {/* Background decoration */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-20 -right-20 w-96 h-96 bg-court-green/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-ball-yellow/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md animate-fade-in-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-court-green shadow-xl mb-4">
            <div className="w-10 h-10 rounded-full bg-ball-yellow animate-ball-bounce" />
          </div>
          <h1 className="font-display text-3xl font-bold text-court-green">
            Welcome Back
          </h1>
          <p className="text-gray-500 mt-2 text-sm">Sign in to your TennisFriends account</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl shadow-court-green/5 border border-court-green-pale/20 p-8">
          <OAuthButtons callbackUrl="/" />

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
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl border border-red-100">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50 transition-colors"
                  placeholder="your@email.com"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50 transition-colors"
                  placeholder="Your password"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full py-3 text-base"
              >
                {loading ? (
                  <svg className="animate-spin w-5 h-5 mx-auto" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                    <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>
          ) : (
            <PhoneAuthForm callbackUrl="/" />
          )}

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              New to the court?{" "}
              <Link href="/register" className="font-semibold text-court-green hover:text-court-green-light transition-colors">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
