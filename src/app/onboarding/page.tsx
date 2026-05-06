"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Gender = "male" | "female" | "non_binary" | "prefer_not_to_say";
type AgeRange = "under_18" | "18_29" | "30_49" | "50_plus";
type RatingSystem = "ntrp" | "utr" | "self";

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

const AGE_OPTIONS: { value: AgeRange; label: string }[] = [
  { value: "under_18", label: "Under 18" },
  { value: "18_29", label: "18–29" },
  { value: "30_49", label: "30–49" },
  { value: "50_plus", label: "50+" },
];

const NTRP_VALUES = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0];

export default function OnboardingPage() {
  const router = useRouter();
  const { update: updateSession } = useSession();

  const [gender, setGender] = useState<Gender | "">("");
  const [ageRange, setAgeRange] = useState<AgeRange | "">("");
  const [ratingSystem, setRatingSystem] = useState<RatingSystem>("ntrp");
  const [ntrp, setNtrp] = useState<number | "">("");
  const [utr, setUtr] = useState<string>("");
  const [selfLevel, setSelfLevel] = useState<string>("intermediate");
  const [club, setClub] = useState<string>("");
  const [city, setCity] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const ratingValid =
    (ratingSystem === "ntrp" && typeof ntrp === "number") ||
    (ratingSystem === "utr" && utr !== "" && Number(utr) >= 1 && Number(utr) <= 16.5) ||
    (ratingSystem === "self" && !!selfLevel);

  const canSubmit = !!gender && !!ageRange && ratingValid && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");

    const payload: Record<string, unknown> = { gender, ageRange, ratingSystem };
    if (ratingSystem === "ntrp") payload.ntrpRating = ntrp;
    if (ratingSystem === "utr") payload.utrRating = Number(utr);
    if (ratingSystem === "self") payload.skillLevel = selfLevel;
    if (club.trim()) payload.club = club.trim();
    if (city.trim()) payload.city = city.trim();

    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Something went wrong");
      setSubmitting(false);
      return;
    }

    await updateSession();
    router.replace("/");
    router.refresh();
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-ball-yellow/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 right-10 w-80 h-80 bg-court-green/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-lg animate-fade-in-up">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-ball-yellow shadow-xl mb-4">
            <svg viewBox="0 0 24 24" className="w-8 h-8 text-court-green" fill="currentColor">
              <circle cx="12" cy="12" r="10" />
              <path d="M7 4.5c1.5 2 2.5 5 2.5 7.5s-1 5.5-2.5 7.5M17 4.5c-1.5 2-2.5 5-2.5 7.5s1 5.5 2.5 7.5" stroke="white" strokeWidth="1.2" fill="none" opacity="0.6" />
            </svg>
          </div>
          <h1 className="font-display text-3xl font-bold text-court-green">
            Tell us about your game
          </h1>
          <p className="text-gray-500 mt-2 text-sm">
            We use this to find you compatible tennis partners.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl shadow-xl shadow-court-green/5 border border-court-green-pale/20 p-8 space-y-6"
        >
          {error && (
            <div className="bg-red-50 text-red-600 text-sm font-medium px-4 py-3 rounded-xl border border-red-100">
              {error}
            </div>
          )}

          {/* Gender */}
          <section>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Gender</label>
            <div className="grid grid-cols-2 gap-2">
              {GENDER_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setGender(opt.value)}
                  className={`px-4 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    gender === opt.value
                      ? "bg-court-green text-white border-court-green shadow-md"
                      : "bg-white text-gray-700 border-gray-200 hover:border-court-green/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Age range */}
          <section>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Age range</label>
            <div className="grid grid-cols-4 gap-2">
              {AGE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setAgeRange(opt.value)}
                  className={`px-2 py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    ageRange === opt.value
                      ? "bg-court-green text-white border-court-green shadow-md"
                      : "bg-white text-gray-700 border-gray-200 hover:border-court-green/40"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          {/* Rating */}
          <section>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Tennis rating
            </label>
            <p className="text-xs text-gray-500 mb-3">
              Pick the system you know best — at least one is required.
            </p>

            <div className="flex gap-1 bg-surface/70 border border-gray-200 rounded-xl p-1 mb-3">
              {(["ntrp", "utr", "self"] as RatingSystem[]).map((sys) => (
                <button
                  type="button"
                  key={sys}
                  onClick={() => setRatingSystem(sys)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
                    ratingSystem === sys
                      ? "bg-white text-court-green shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {sys === "ntrp" ? "USTA / NTRP" : sys === "utr" ? "UTR" : "Self-rated"}
                </button>
              ))}
            </div>

            {ratingSystem === "ntrp" && (
              <select
                value={ntrp === "" ? "" : String(ntrp)}
                onChange={(e) => setNtrp(e.target.value ? Number(e.target.value) : "")}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50 appearance-none"
              >
                <option value="">Select your NTRP rating…</option>
                {NTRP_VALUES.map((v) => (
                  <option key={v} value={v}>
                    {v.toFixed(1)}
                  </option>
                ))}
              </select>
            )}

            {ratingSystem === "utr" && (
              <input
                type="number"
                step="0.01"
                min={1}
                max={16.5}
                value={utr}
                onChange={(e) => setUtr(e.target.value)}
                placeholder="e.g. 7.25"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50"
              />
            )}

            {ratingSystem === "self" && (
              <select
                value={selfLevel}
                onChange={(e) => setSelfLevel(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50 appearance-none"
              >
                <option value="beginner">Beginner — still learning the basics</option>
                <option value="intermediate">Intermediate — consistent rallies</option>
                <option value="advanced">Advanced — strong all-around game</option>
                <option value="professional">Professional / tournament</option>
              </select>
            )}
          </section>

          <section>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Home club / court</label>
            <input
              type="text"
              value={club}
              onChange={(e) => setClub(e.target.value)}
              placeholder="e.g. Tennis Center Sand Point"
              maxLength={30}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50"
            />
          </section>

          <section>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Current city</label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="e.g. Seattle"
              maxLength={30}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm bg-surface/50"
            />
          </section>

          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary w-full py-3 text-base"
          >
            {submitting ? (
              <svg className="animate-spin w-5 h-5 mx-auto" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3" />
                <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            ) : (
              "Continue"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
