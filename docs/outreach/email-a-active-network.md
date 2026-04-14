# Email A — Active Network Developer Support

**To:** `developersupport@activenetwork.com`
**Cc (optional):** submit the same text via the contact form at `developer.active.com`
**Subject:** Partner API access request — Seattle Parks tennis availability (read-only)

---

Hi Active Network team,

I'm Jun Fang, an independent developer building **TennisFriend**, a small consumer app that helps Seattle-area tennis players find partners and open court times. I'd like to request partner API access to your facility schedules endpoint, scoped to the Seattle Parks & Recreation org.

**Specifically, I'm requesting:**

- Read-only access to `https://api.amp.active.com/anet-systemapi-sec/{orgId}/api/v1/facilityschedules`
- Scoped to the Seattle Parks & Recreation org (the same org that runs `anc.apm.activecommunities.com/seattle`)
- Tennis facilities only (indoor + outdoor — ActiveNet facility types 39 and 115 in Seattle's catalog)
- Sandbox credentials first, so I can validate the signature flow and response parsing before any production traffic

**Use case — availability discovery with deep-link handoff to your booking flow:**

TennisFriend surfaces real-time court availability inside the app so users can instantly see which Seattle Parks courts are open near them. When a user taps a slot they want, the app deep-links them straight into your existing ActiveNet reservation flow — pre-filled with the right venue, court, and time — where they complete authentication, payment, and confirmation on your platform.

In other words, **my app drives qualified demand into your existing booking funnel**. I'm not building a parallel booking system, taking payments, or holding ActiveNet credentials. The user's reservation is always created, paid for, and managed inside Seattle Parks' ActiveNet UI — I just help them find the right slot faster.

Today, I render estimated operating hours (since I have no real-time data) and embed the Seattle Parks reservation page in an in-app webview for the booking step. A proper API relationship would let me show genuine availability on the discovery side and make the handoff into your booking flow cleaner.

**Expected traffic:**

- Under 10,000 requests/day at current scale (solo dev, pre-launch).
- Server-side calls only (no client-side key exposure).
- Aggressive caching: 1-hour TTL on the facility list (already implemented), 10–15 minute TTL on availability — tunable to whatever rate limits you require.

**On my side:**

- Solo individual developer; happy to sign standard partner terms / NDA.
- Willing to display "Powered by Active Network" attribution wherever slots render, and clear "Booking completed on Seattle Parks" messaging at the handoff point.
- I've already reached out to the Seattle Parks tennis scheduling team at Amy Yee Tennis Center (`tenniscourtscheduling@seattle.gov`) — they operate SPR's ActiveCommunities tennis reservations — so they're aware and ready when you verify the partnership on their side.

**Technical context (if helpful):**

I've already built the scaffolding in code — my REST client uses your unauthenticated resource list endpoint today with 1-hour caching, and my availability route is ready to switch to the signed partner URL the moment I have `api_key` + `shared_secret` + `org_id`. Sandbox keys would let me finalize the signature generation and response mapping against your current docs (I want to confirm whether the current signature is SHA-256 of `apiKey + sharedSecret + timestamp`, which is what the older Active Works docs showed).

Happy to hop on a call or fill out any formal partner request you need. What's the best next step?

Thank you,

**Jun Fang**
Solo developer — TennisFriend
[email — fill in]
[phone — optional]
