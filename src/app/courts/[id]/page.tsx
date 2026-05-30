"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import PrivacyNotice from "@/components/courts/PrivacyNotice";
import { StarRating } from "@/components/courts/StarRating";
import { CourtPhotoGrid } from "@/components/courts/CourtPhotoGrid";
import { ReviewList, type Review } from "@/components/courts/ReviewList";
import { ReviewComposer } from "@/components/courts/ReviewComposer";
import { ReportIssueModal } from "@/components/courts/ReportIssueModal";
import { CourtStatusReporter } from "@/components/courts/CourtStatusReporter";
import { isReportEligibleCategory } from "@/lib/courtPrompt";
import { DirectionsButton } from "@/components/courts/DirectionsButton";
import { getFacilityByCourtId, getSeattleParksDashboardUrl } from "@/lib/facilities";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listCourtReviews } from "@/lib/supabase/queries";
import { getCurrentPosition, isPositionError } from "@/lib/getCurrentPosition";
import { errorMessage } from "@/lib/errorMessage";

// Mirrors `Facility` in src/lib/facilities.ts plus the dashboard URL the
// detail API attaches conditionally.
interface CourtDetail {
  courtId: string;
  externalId: number;
  name: string;
  address: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  courtCount: number | null;
  lighted: boolean | null;
  hittingWall: boolean | null;
  pickleballLined: boolean | null;
  indoorOutdoor: "outdoor" | "indoor" | "both";
  managedBy: string | null;
  reservationPolicy: string | null;
  contactPhone: string | null;
  bookingUrl: string | null;
  courtLevelBookingUrl: string | null;
  bookingLabel: string | null;
  bookingLinks: Array<{ label: string; url: string }> | null;
  eventsLink: { label: string; url: string } | null;
  hours: string | null;
  description: string | null;
  notes: string | null;
  category:
    | "public_park"
    | "school"
    | "private_club"
    | "hoa_community"
    | "college"
    | "indoor_facility";
  status: "active" | "temporarily_closed";
  bucket: "city" | "club" | "school";
  /** Power BI dashboard URL when the venue is a reservable Seattle Parks court. */
  dashboardUrl: string | null;
}

type ReviewsPayload = {
  avg: number;
  count: number;
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
  mine: Review | null;
  reviews: Review[];
};

const CATEGORY_LABEL: Record<CourtDetail["category"], string> = {
  public_park: "Public Park",
  school: "School",
  private_club: "Private Club",
  hoa_community: "HOA / Residents Only",
  college: "College",
  indoor_facility: "Indoor Facility",
};

const INDOOR_LABEL: Record<CourtDetail["indoorOutdoor"], string> = {
  outdoor: "Outdoor",
  indoor: "Indoor",
  both: "Indoor + Outdoor",
};

type Tab = "overview" | "reviews";

export default function CourtDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  // Pass-through query params: `z`, `lat`, `lng` carry the user's previous
  // map view (set by the summary card's Details link). We append them to the
  // breadcrumb so /courts can restore the exact zoom on return.
  const searchParams = useSearchParams();
  const backHref = (() => {
    const parts: string[] = [`selected=${encodeURIComponent(id)}`];
    for (const k of ["z", "lat", "lng"] as const) {
      const v = searchParams.get(k);
      if (v) parts.push(`${k}=${encodeURIComponent(v)}`);
    }
    return `/courts?${parts.join("&")}`;
  })();
  const [court, setCourt] = useState<CourtDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [dashboardOpen, setDashboardOpen] = useState(false);
  // Mount the Power BI iframe as soon as the availability button scrolls
  // into view, well before the user taps. We then toggle the modal's
  // visibility (display:none ↔ flex) instead of unmounting the iframe, so
  // Power BI's bundle is fetched once per page-load and reopens are instant.
  // On iOS especially, the old hover/focus gate effectively fired at the
  // same time as the tap (no real hover), so users paid the full ~2–4s
  // cold load every open.
  const [mountDashboardIframe, setMountDashboardIframe] = useState(false);
  const availabilityButtonRef = useRef<HTMLButtonElement | null>(null);
  // Geolocation for the Directions chooser's `origin` param — the chosen
  // map app opens with the route already drawn instead of asking "from
  // where?". Silent on denial; the chooser still works (the app prompts).
  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pos = await getCurrentPosition();
      if (cancelled || isPositionError(pos)) return;
      setMyLocation({ lat: pos.latitude, lng: pos.longitude });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const [reviews, setReviews] = useState<ReviewsPayload | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [recentReports, setRecentReports] = useState<{
    count: number;
    emptyCount: number;
    lastReportedAt: string | null;
  } | null>(null);

  const fetchCourt = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const facility = getFacilityByCourtId(id);
      if (!facility) {
        throw new Error("Court not found");
      }
      // Static-catalog facility plus the legacy "dashboard URL" computed
      // client-side. Replaces the deleted /api/courts/[id] route which
      // wrapped this lookup. Gating mirrors the original API: only SPR
      // venues that are actually reservable, and not opted-out via
      // `showAvailabilityDashboard: false` (e.g. high-school complexes
      // not on the dashboard's reservable list).
      const dashboardUrl =
        facility.managedBy === "Seattle Parks & Recreation" &&
        facility.bookingUrl &&
        facility.showAvailabilityDashboard
          ? getSeattleParksDashboardUrl()
          : null;
      const detail: CourtDetail = {
        ...facility,
        dashboardUrl,
      } as unknown as CourtDetail;
      setCourt(detail);
    } catch (e) {
      setError(errorMessage(e, "Something went wrong"));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchReviews = useCallback(async () => {
    setReviewsLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const rows = await listCourtReviews(supabase, id);
      const { data: auth } = await supabase.auth.getUser();
      const myId = auth.user?.id ?? null;
      // Distribution + averages — used to be computed server-side.
      const distribution: { 1: number; 2: number; 3: number; 4: number; 5: number } = {
        1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
      };
      let sum = 0;
      for (const r of rows) {
        sum += r.stars;
        if (r.stars >= 1 && r.stars <= 5) {
          distribution[r.stars as 1 | 2 | 3 | 4 | 5] += 1;
        }
      }
      const reviewsList = rows.map((r) => ({
        id: r.id,
        stars: r.stars,
        content: r.content,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        photoUrls: r.photos.map((p) => p.url),
        user: {
          id: r.user.id,
          name: r.user.name,
          profileImageUrl: r.user.profile_image_url,
        },
      }));
      const mine = myId ? reviewsList.find((r) => r.user.id === myId) ?? null : null;
      setReviews({
        avg: rows.length === 0 ? 0 : sum / rows.length,
        count: rows.length,
        distribution,
        mine: mine as unknown as ReviewsPayload["mine"],
        reviews: reviewsList as unknown as Review[],
      });
    } catch {
      setReviews({ avg: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, mine: null, reviews: [] });
    } finally {
      setReviewsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCourt();
    fetchReviews();
  }, [fetchCourt, fetchReviews]);

  // Open the TCP+TLS handshake to Power BI's CDN the moment we know this
  // venue has a dashboard, so the user's tap on "Check court availability"
  // doesn't pay for the connection setup. Free (a few KB of TLS chatter)
  // and removed when leaving the page.
  useEffect(() => {
    if (!court?.dashboardUrl) return;
    const preconnect = document.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = "https://app.powerbigov.us";
    preconnect.crossOrigin = "anonymous";
    document.head.appendChild(preconnect);
    const dns = document.createElement("link");
    dns.rel = "dns-prefetch";
    dns.href = "https://app.powerbigov.us";
    document.head.appendChild(dns);
    return () => {
      preconnect.remove();
      dns.remove();
    };
  }, [court?.dashboardUrl]);

  // Mount the (hidden) dashboard iframe as soon as the availability button
  // is visible, so Power BI's bundle is downloading while the user reads
  // the rest of the page. rootMargin gives a small head-start when the
  // button is just below the fold. Disconnects after firing once.
  useEffect(() => {
    if (!court?.dashboardUrl) return;
    if (mountDashboardIframe) return;
    const el = availabilityButtonRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setMountDashboardIframe(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setMountDashboardIframe(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [court?.dashboardUrl, mountDashboardIframe]);

  // Lock the device to landscape while the dashboard modal is open: the
  // Power BI report is built for ≈16:10 landscape and is tiny in a
  // portrait phone. iOS rotates the entire WebView, so the modal lays
  // out wide and Power BI fills it at full size. Plugin only loads on
  // native Capacitor; on web the calls silently no-op so we preserve
  // today's behavior in the browser build. Cleanup unlocks on close,
  // unmount, or navigation away — leaving the rest of the app free to
  // be portrait again.
  useEffect(() => {
    if (!dashboardOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (cancelled || !Capacitor.isNativePlatform()) return;
        const { ScreenOrientation } = await import(
          "@capacitor/screen-orientation"
        );
        await ScreenOrientation.lock({ orientation: "landscape" });
      } catch {
        // Plugin unavailable or lock rejected — fall back to no-op.
      }
    })();
    return () => {
      cancelled = true;
      (async () => {
        try {
          const { Capacitor } = await import("@capacitor/core");
          if (!Capacitor.isNativePlatform()) return;
          const { ScreenOrientation } = await import(
            "@capacitor/screen-orientation"
          );
          await ScreenOrientation.unlock();
        } catch {
          // Unlock failure isn't worth surfacing — orientation will
          // settle on whatever the parent screen requests.
        }
      })();
    };
  }, [dashboardOpen]);

  const eligibleForReports = isReportEligibleCategory(court?.category);

  const refreshReports = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("court_availability_reports")
        .select("has_empty, reported_at")
        .eq("court_id", id)
        .gte("reported_at", sinceIso);
      const rows = (data ?? []) as Array<{ has_empty: boolean; reported_at: string }>;
      if (rows.length === 0) {
        setRecentReports(null);
        return;
      }
      let emptyCount = 0;
      for (const r of rows) {
        if (r.has_empty) emptyCount += 1;
      }
      const latest = rows.reduce((acc, r) => (r.reported_at > acc.reported_at ? r : acc));
      setRecentReports({
        count: rows.length,
        emptyCount,
        lastReportedAt: latest.reported_at,
      });
    } catch {
      // ignore
    }
  }, [id]);

  useEffect(() => {
    if (!eligibleForReports) {
      setRecentReports(null);
      return;
    }
    void refreshReports();
  }, [eligibleForReports, refreshReports]);

  const deleteReview = useCallback(async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      await supabase
        .from("court_reviews")
        .delete()
        .eq("court_id", id)
        .eq("user_id", auth.user.id);
    } catch {
      // ignore
    }
    fetchReviews();
  }, [id, fetchReviews]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-20 bg-gray-200 rounded" />
          <div className="h-8 w-64 bg-gray-200 rounded" />
          <div className="h-4 w-48 bg-gray-200 rounded" />
          <div className="h-64 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !court) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Link
          href={backHref}
          className="text-sm text-court-green hover:underline mb-4 inline-block"
        >
          &larr; Back to Courts
        </Link>
        <div className="bg-red-50 rounded-xl border border-red-200 p-6 text-center">
          <p className="text-red-600 font-medium">{error || "Court not found"}</p>
          <button
            onClick={fetchCourt}
            className="mt-3 text-sm font-semibold text-red-700 bg-red-100 px-4 py-2 rounded-lg hover:bg-red-200"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const reviewPhotos = reviews?.reviews.flatMap((r) => r.photoUrls) ?? [];
  const isClosed = court.status === "temporarily_closed";

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Breadcrumb — preserves which court was viewed (and the user's
          previous zoom + center) so the map reopens its summary card at
          the exact view they left, instead of resetting to user's location
          or jumping to street-level. */}
      <Link
        href={backHref}
        className="text-sm text-court-green hover:underline mb-4 inline-flex items-center gap-1"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
        All Courts
      </Link>

      {/* Hero photos */}
      {reviewPhotos.length > 0 && (
        <div className="mt-3">
          <CourtPhotoGrid photos={reviewPhotos.slice(0, 7)} />
        </div>
      )}

      {/* Header */}
      <div className="mt-4 mb-5">
        <h1 className="font-display text-2xl font-bold text-court-green">
          {court.name}
        </h1>
        <p className="text-gray-500 text-sm mt-1">{court.address}</p>

        {/* Category + status chips */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-700 text-xs font-medium">
            {CATEGORY_LABEL[court.category]}
          </span>
          {court.managedBy && court.managedBy !== "School" && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-gray-50 text-gray-500 text-xs">
              {court.managedBy}
            </span>
          )}
          {isClosed && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-semibold uppercase tracking-wide">
              Temporarily closed
            </span>
          )}
        </div>

        {/* Rating row */}
        {reviews && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {reviews.count > 0 ? (
              <>
                <span className="text-base font-semibold text-gray-800">
                  {reviews.avg.toFixed(1)}
                </span>
                <StarRating value={reviews.avg} size={16} />
                <button
                  onClick={() => setTab("reviews")}
                  className="text-sm text-gray-500 hover:underline"
                >
                  ({reviews.count} review{reviews.count === 1 ? "" : "s"})
                </button>
              </>
            ) : (
              <span className="text-sm text-gray-400">No reviews yet</span>
            )}
          </div>
        )}

        {/* Amenities row */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {court.courtCount != null && (
            <Chip>
              {court.courtCount} court{court.courtCount === 1 ? "" : "s"}
            </Chip>
          )}
          <Chip>{INDOOR_LABEL[court.indoorOutdoor]}</Chip>
          {court.lighted && <Chip tone="amber">Lighted</Chip>}
          {court.hittingWall && <Chip>Hitting wall</Chip>}
          {court.pickleballLined && <Chip>Pickleball-lined</Chip>}
        </div>

        {/* Quick action: write/edit review */}
        <div className="mt-4">
          <button
            onClick={() => setComposerOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-court-green text-white text-sm font-semibold hover:bg-court-green-light transition-colors shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polygon points="12 2 15.1 8.6 22 9.6 17 14.5 18.2 21.5 12 18.2 5.8 21.5 7 14.5 2 9.6 8.9 8.6" />
            </svg>
            {reviews?.mine ? "Edit your review" : "Write a review"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-5 flex gap-6">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </TabButton>
        <TabButton active={tab === "reviews"} onClick={() => setTab("reviews")}>
          Reviews{reviews?.count ? ` (${reviews.count})` : ""}
        </TabButton>
      </div>

      {tab === "overview" && (
        <>
          {/* `notes` is dev-only metadata (source conflicts, scraper caveats);
              the public "Temporarily closed" chip above already conveys
              status to users. */}

          {/* Primary CTA: booking.
              Per-venue `bookingLinks` (e.g. Aubrey Davis Park, where each
              court has its own PerfectMind URL) renders as a row of buttons
              and replaces the single "Book this court". Otherwise: single
              button + optional Seattle Parks availability dashboard. */}
          {!isClosed && court.bookingLinks && court.bookingLinks.length > 0 && (
            <div className="mb-5 flex flex-col sm:flex-row flex-wrap gap-2">
              {court.bookingLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary flex-1 min-w-[10rem] flex items-center justify-center gap-2 py-3"
                >
                  {link.label}
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  >
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              ))}
            </div>
          )}
          {!isClosed && !court.bookingLinks && court.bookingUrl && (
            <div className="mb-5 flex flex-col sm:flex-row gap-2">
              <a
                href={court.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex-1 flex items-center justify-center gap-2 py-3"
              >
                {court.bookingLabel ?? "Book this court"}
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
              {court.dashboardUrl && (
                <button
                  ref={availabilityButtonRef}
                  onClick={() => {
                    setMountDashboardIframe(true);
                    setDashboardOpen(true);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-ball-yellow/30 hover:bg-ball-yellow/50 text-amber-800 font-semibold text-sm"
                >
                  📊 Check court availability
                </button>
              )}
            </div>
          )}

          {/* How to book / reservation policy */}
          {court.reservationPolicy && (
            <Section title="How to book">
              <p className="text-sm text-gray-700 whitespace-pre-line">
                {court.reservationPolicy}
              </p>
            </Section>
          )}

          {/* Hours */}
          {court.hours && (
            <Section title="Hours">
              <p className="text-sm text-gray-700 whitespace-pre-line">
                {court.hours}
              </p>
            </Section>
          )}

          {/* Events / external schedule link (e.g. UW IMA). Sits alongside
              Hours since both are scheduling info. */}
          {court.eventsLink && (
            <Section title="Events">
              <a
                href={court.eventsLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-ball-yellow/30 hover:bg-ball-yellow/50 text-amber-800 font-semibold text-sm"
              >
                📅 {court.eventsLink.label}
              </a>
            </Section>
          )}

          {/* Description */}
          {court.description && (
            <Section title="About this court">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                {court.description}
              </p>
            </Section>
          )}

          {/* Crowd-sourced court status — a recent-reports banner (last 60
              min) plus a manual reporter. The reporter does a single on-tap
              GPS check to confirm the user is on-site; there's no background
              location polling. Shown on all report-eligible categories. */}
          {eligibleForReports && (
            <Section title="Court status">
              {recentReports && recentReports.emptyCount > 0 && recentReports.lastReportedAt && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5 mb-3">
                  <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                  <p className="text-sm text-amber-900">
                    {recentReports.emptyCount === 1
                      ? "1 player reported empty courts here in the last hour"
                      : `${recentReports.emptyCount} players reported empty courts here in the last hour`}
                    {" — "}
                    <span className="text-amber-700">
                      most recent at{" "}
                      {new Date(recentReports.lastReportedAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </p>
                </div>
              )}
              <CourtStatusReporter
                courtId={id}
                venueName={court.name}
                lat={court.latitude}
                lng={court.longitude}
                variant="detail"
                onReported={refreshReports}
              />
            </Section>
          )}

          {/* Contact */}
          {court.contactPhone && (
            <Section title="Contact">
              <a
                href={`tel:${court.contactPhone.replace(/[^\d+]/g, "")}`}
                className="text-sm text-court-green hover:underline inline-flex items-center gap-2"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.95.37 1.87.72 2.74a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.34-1.34a2 2 0 012.11-.45c.87.35 1.79.59 2.74.72A2 2 0 0122 16.92z" />
                </svg>
                {court.contactPhone}
              </a>
            </Section>
          )}
        </>
      )}

      {tab === "reviews" && (
        <div className="mb-6">
          {reviewsLoading || !reviews ? (
            <div className="py-8 text-center text-gray-400 text-sm">Loading reviews…</div>
          ) : (
            <>
              {reviews.count > 0 && (
                <div className="mb-5 bg-white rounded-xl border border-gray-100 p-4">
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-gray-900">
                      {reviews.avg.toFixed(1)}
                    </span>
                    <div>
                      <StarRating value={reviews.avg} size={16} />
                      <p className="text-xs text-gray-500 mt-0.5">
                        {reviews.count} review{reviews.count === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1">
                    {[5, 4, 3, 2, 1].map((s) => {
                      const c = reviews.distribution[s as 1 | 2 | 3 | 4 | 5];
                      const pct = reviews.count === 0 ? 0 : (c / reviews.count) * 100;
                      return (
                        <div key={s} className="flex items-center gap-2 text-xs">
                          <span className="w-3 text-right text-gray-500">{s}</span>
                          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-400"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="w-6 text-right text-gray-400">{c}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <ReviewList
                reviews={reviews.reviews}
                onEdit={() => setComposerOpen(true)}
                onDelete={deleteReview}
              />
            </>
          )}
        </div>
      )}

      {/* Directions use the venue's stored lat/lng as destination — the
          dataset is hand-maintained so coords are authoritative. Tapping
          opens a chooser between Apple Maps and Google Maps; either one
          gets the user's geolocation as `origin` when available. */}
      {court.latitude != null && court.longitude != null && (
        <div className="mb-6">
          <DirectionsButton
            lat={court.latitude}
            lng={court.longitude}
            myLocation={myLocation}
            destinationLabel={court.address ?? court.name}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-court-green transition-colors"
            ariaLabel={`Get directions to ${court.name}`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            Get Directions
          </DirectionsButton>
        </div>
      )}

      {/* Report-an-issue: opens an in-app modal that POSTs to
          /api/report-issue → developer's email. Low-prominence footer link. */}
      <div className="mb-4">
        <button
          type="button"
          onClick={() => setReportOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-court-green transition-colors"
          aria-label={`Report an issue with ${court.name}`}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          Report an issue with this court
        </button>
      </div>

      {/* Privacy */}
      <PrivacyNotice />

      {composerOpen && (
        <ReviewComposer
          courtId={court.courtId}
          courtName={court.name}
          initial={
            reviews?.mine
              ? {
                  stars: reviews.mine.stars,
                  content: reviews.mine.content,
                  photoUrls: reviews.mine.photoUrls,
                }
              : null
          }
          onClose={() => setComposerOpen(false)}
          onSaved={() => {
            setComposerOpen(false);
            fetchReviews();
            setTab("reviews");
          }}
        />
      )}

      {reportOpen && (
        <ReportIssueModal
          courtId={court.courtId}
          courtName={court.name}
          courtAddress={court.address ?? null}
          onClose={() => setReportOpen(false)}
        />
      )}

      {/* Seattle Parks Power BI availability dashboard.
          Mounted once `mountDashboardIframe` flips (button on screen or
          tapped) and kept alive across opens — closing the modal just
          hides the wrapper with display:none so the second open is
          instant. The iframe document keeps running inside a hidden
          parent, so Power BI's bundle stays warm. Modal height is pinned
          because Power BI collapses to a tiny intrinsic height given
          only max-h. */}
      {mountDashboardIframe && court.dashboardUrl && (
        <div
          className={`${
            dashboardOpen ? "flex" : "hidden"
          } fixed inset-0 z-[600] bg-black/60 items-end sm:items-center justify-center p-0 sm:p-4 [@media(max-height:500px)]:p-0`}
          aria-hidden={!dashboardOpen}
          onClick={() => setDashboardOpen(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-5xl h-[90vh] sm:h-[85vh] flex flex-col overflow-hidden [@media(max-height:500px)]:h-screen [@media(max-height:500px)]:max-w-none [@media(max-height:500px)]:rounded-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 [@media(max-height:500px)]:py-1">
              <div className="[@media(max-height:500px)]:hidden">
                <h3 className="font-semibold text-gray-900 text-sm">Court availability</h3>
                <p className="text-[11px] text-gray-500">
                  Powered by Seattle Parks &amp; Recreation
                </p>
              </div>
              <button
                onClick={() => setDashboardOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center [@media(max-height:500px)]:ml-auto"
                aria-label="Close availability"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <iframe
              src={court.dashboardUrl}
              title="Seattle Parks tennis court availability"
              className="w-full flex-1 border-0"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`pb-3 -mb-px text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "border-court-green text-court-green"
          : "border-transparent text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "amber";
}) {
  const cls =
    tone === "amber"
      ? "bg-ball-yellow/20 text-amber-700"
      : "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium capitalize ${cls}`}
    >
      {children}
    </span>
  );
}
