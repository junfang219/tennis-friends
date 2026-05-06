"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

type Step = "phone" | "code";

export default function PhoneAuthForm({ callbackUrl = "/onboarding" }: { callbackUrl?: string }) {
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devMode, setDevMode] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/phone/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not send code");
        return;
      }
      setDevMode(Boolean(data.devMode));
      setStep("code");
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("phone-otp", {
      phone,
      code,
      redirect: false,
    });
    setLoading(false);
    if (!result || result.error) {
      setError("Invalid or expired code. Try again.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  if (step === "phone") {
    return (
      <form onSubmit={sendCode} className="space-y-4">
        {error && (
          <div className="bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl border border-red-100">
            {error}
          </div>
        )}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">Phone number</label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50"
            placeholder="(206) 555-0123"
            required
          />
          <p className="mt-1.5 text-xs text-gray-500">We&rsquo;ll text you a 6-digit code.</p>
        </div>
        <button type="submit" disabled={loading || !phone} className="btn-primary w-full py-3 text-base">
          {loading ? "Sending..." : "Send code"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submitCode} className="space-y-4">
      {error && (
        <div className="bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl border border-red-100">
          {error}
        </div>
      )}
      {devMode && (
        <div className="bg-ball-yellow/20 text-gray-800 text-xs font-medium px-4 py-3 rounded-xl border border-ball-yellow/40">
          Dev mode: no SMS was sent. Use code <span className="font-mono font-bold">000000</span>.
        </div>
      )}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Verification code</label>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{4,8}"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50 tracking-widest text-center font-mono"
          placeholder="••••••"
          required
          maxLength={8}
        />
        <p className="mt-1.5 text-xs text-gray-500">
          Sent to {phone}.{" "}
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setCode("");
              setError("");
            }}
            className="text-court-green font-semibold hover:underline"
          >
            Change number
          </button>
        </p>
      </div>
      <button type="submit" disabled={loading || code.length < 4} className="btn-primary w-full py-3 text-base">
        {loading ? "Verifying..." : "Verify & continue"}
      </button>
    </form>
  );
}
