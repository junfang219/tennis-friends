/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Lift the 10 MB Route Handler body cap so /api/upload can accept videos
  // up to its own 100 MB limit. Both keys are set: serverActions.bodySizeLimit
  // covers Server Actions; middlewareClientMaxBodySize covers Route Handlers
  // (Next.js's runtime warning points at this exact key).
  experimental: {
    serverActions: { bodySizeLimit: "100mb" },
    // Slight headroom over /api/upload's own 100 MB cap so the route's
    // structured 400 ("File must be under 100MB") fires for files just over
    // the limit, instead of the platform truncating them silently.
    middlewareClientMaxBodySize: "110mb",
  },
};
export default nextConfig;
