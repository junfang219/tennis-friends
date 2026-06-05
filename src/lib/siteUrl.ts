// Canonical public base URL for shareable links — QR codes, invite links, OG
// previews. NEXT_PUBLIC_SITE_URL lets prod/staging override; otherwise the
// production domain.
//
// Deliberately NOT window.location.origin: on a dev machine that's
// localhost (or a LAN IP), which a recipient's phone can't reach and which
// also bypasses the universal-link domain (mytennisfriends.com) that the AASA
// file claims. A shared QR must always point at the public site.
export function publicSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://mytennisfriends.com";
}
