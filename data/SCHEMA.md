# Tennis Courts Dataset — Schema & Usage Guide

**For:** Tennis Friends app map view
**Files:** `tennis_courts.json` (primary), `tennis_courts.csv` (flat alternative)
**Region:** Greater Seattle (King, Pierce, Snohomish, Kitsap counties + Bainbridge Island)
**Total:** 268 venues, 959 courts

## File format

`tennis_courts.json` is the canonical source:

```json
{
  "metadata": { "version": "1.0", "updated": "2026-05-12", ... },
  "venues": [ /* 268 venue objects */ ]
}
```

## Venue object schema

| Field | Type | Notes |
|---|---|---|
| `id` | int | Stable 1-based id. Use as DB primary key seed. |
| `name` | string | Venue display name. |
| `address` | string | Full address, ready for geocoding. |
| `street`, `city`, `state`, `zip` | string \| null | Pre-parsed components. Some intersection-style entries leave `street` null. |
| `latitude`, `longitude` | null | **Always null** — geocode at ingest. |
| `court_count` | int \| null | Tennis-playable courts. Null = unverified. |
| `lighted` | bool \| null | |
| `hitting_wall` | bool \| null | Practice bang-board / backboard. |
| `pickleball_lined` | bool \| null | True if courts have pickleball striping OR venue has separate pickleball courts. Check `notes` for distinction when it matters. |
| `indoor_outdoor` | `"outdoor"` \| `"indoor"` \| `"both"` | "both" = seasonal (winter bubbles) or facility with separate indoor/outdoor courts. |
| `managed_by` | string | Operating entity. Schools share `"School"` (intentional, group at app level). |
| `reservation_policy` | string \| null | Free-text booking/access info. |
| `contact_phone` | string \| null | Standard format `(NNN) NNN-NNNN`. |
| `booking_url` | string \| null | Direct online booking URL. |
| `court_level_booking_url` | string \| null | Per-court availability dashboard (Seattle Parks individual courts often). |
| `hours` | string \| null | Human-readable hours. |
| `description` | string \| null | One-paragraph venue description for popup body. |
| `notes` | string \| null | Operational caveats (closures, source conflicts, multi-use info). |
| `category` | enum | See below. |
| `status` | `"active"` \| `"temporarily_closed"` | Closed venues retain all fields plus a closure note. |

## Categories

| Value | Count | Description |
|---|---|---|
| `public_park` | 161 | City/county parks (Seattle Parks, Parks Tacoma, Bellevue Parks, King County, etc.) |
| `school` | 56 | K-12 schools — public access typically after school hours |
| `private_club` | 32 | Member-owned clubs (TLTC, Seattle Tennis Club, country clubs, Gorin facilities, Nordstrom Tennis Center) |
| `hoa_community` | 9 | HOA residential courts (Klahanie, Trossachs, Blue Ridge, etc.) — residents only |
| `college` | 6 | UW IMA, Seattle U, UPS, Northwest University, Green River College |
| `indoor_facility` | 4 | Public-access indoor centers: Amy Yee Indoor, Galbraith, Sprinker Indoor, Bainbridge Island Rec Center |

**`category` is orthogonal to `indoor_outdoor`.** A `private_club` can be indoor or outdoor. Filter on both fields independently.

## Status

- `active` (264 venues) — currently playable
- `temporarily_closed` (4 venues) — Reservoir Park (Redmond), Forest Park (Everett), Cowen Park (Seattle), Edgewater Park (Everett). All have construction-completion timelines in `notes`. Recommend gray/striped markers with "Opening Soon" tooltip.

## Geocoding

Coordinates aren't pre-computed. Recommended:
1. **Google Geocoding API** — best accuracy for these addresses.
2. **Mapbox Geocoding API** — solid fallback.
3. **Cache** the result, persist `latitude`/`longitude` to your DB. `id` is stable across dataset revisions.

A few intersection-style addresses (Madison Park, Medina Park, Fairweather) have street-name-only components; geocoders handle them correctly because city+zip are appended.

## Suggested Prisma schema

```prisma
model Facility {
  id                    Int       @id @default(autoincrement())
  externalId            Int       @unique // maps to dataset 'id'
  name                  String
  address               String
  street                String?
  city                  String?
  state                 String?
  zip                   String?
  latitude              Float?
  longitude             Float?
  courtCount            Int?
  lighted               Boolean?
  hittingWall           Boolean?
  pickleballLined       Boolean?
  indoorOutdoor         IndoorOutdoor
  managedBy             String
  reservationPolicy     String?
  contactPhone          String?
  bookingUrl            String?
  courtLevelBookingUrl  String?
  hours                 String?
  description           String?   @db.Text
  notes                 String?   @db.Text
  category              Category
  status                Status    @default(ACTIVE)
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
  sessions              Session[]
}

enum IndoorOutdoor { OUTDOOR INDOOR BOTH }
enum Category { PUBLIC_PARK SCHOOL PRIVATE_CLUB INDOOR_FACILITY HOA_COMMUNITY COLLEGE }
enum Status { ACTIVE TEMPORARILY_CLOSED }
```

## Map display recommendations

1. **Marker color by category**:
   - `public_park` → green
   - `school` → blue
   - `private_club` → gold
   - `indoor_facility` → purple
   - `hoa_community` → gray
   - `college` → maroon
2. **Indoor badge** — small overlay icon for `indoor` and `both`.
3. **Closed venues** — gray dashed border, "Opening Soon" tooltip from `notes`.
4. **Marker clustering** — needed at zoom-out levels; 268 markers overlap heavily.
5. **High-value filter dimensions**: `category`, `lighted`, `pickleball_lined`, `indoor_outdoor`, `status`, `city`.
6. **Popup priority**: name → court_count + amenity row → reservation_policy → contact_phone/booking_url → description.

## Known caveats

- **Closed venues** — Reservoir reopens with 3 courts; Forest Park (Everett) reopens June 2026; Cowen Park timing unknown; Edgewater Park reopens Fall 2026 as tennis/pickleball/basketball multi-use.
- **Watchlist** — Evergreen Playfield Complex (Mountlake Terrace) drops from 4 → 3 tennis courts after summer 2026 renovation.
- **HOA/private** — display "members only" or "residents only" badges; `reservation_policy` calls this out.
- **School courts** — public-access timing varies by district; `reservation_policy` captures known policies.
- **Multi-row facilities** — A few physical sites are intentionally split:
  - Amy Yee Tennis Center (outdoor + indoor rows)
  - Sprinker Recreation Center (outdoor + indoor)
  - Klahanie HOA (Summit, Lakeside, Mountainview — separate physical facilities within one community)
  
  These dedupe naturally at geocoded coordinates but display as distinct markers.


## External resources (`metadata.external_resources`)

Some jurisdictions provide additional public-facing court resources at the city/region level (not per-venue). These are surfaced in `metadata.external_resources`:

### `seattle_parks_availability_dashboard`

Seattle Parks & Recreation publishes a Power BI dashboard showing current booking status for their **reservable** tennis courts.

**Applies to:** `managed_by == "Seattle Parks & Recreation" AND booking_url IS NOT NULL` — **44 venues** (the ones reservable through the city's ActiveCommunities reservation system).

**Does NOT apply to:** 13 Seattle Parks venues that are first-come-only (no booking_url). These aren't tracked by the dashboard because they have no reservations to display. Don't show the "Check availability" button on these.

**Embedding guidance:**

The URL is a Power BI "Publish to web" link (`app.powerbigov.us/view?r=...`). Microsoft allows iframe embedding on these URLs, but Power BI dashboards are designed for desktop landscape viewing and load slowly (4–8 sec).

**Recommended pattern** for mobile-first apps:
- ❌ Don't embed inline on venue popups (multiplies the same iframe 44×, slow load, bad mobile UX)
- ✅ Show a button: `📊 Check court availability` on the **44 reservable** Seattle Parks venue cards only (filter on `managed_by == 'Seattle Parks & Recreation' AND booking_url IS NOT NULL`)
- ✅ On tap, open in modal/sheet, in-app webview, or new tab — your choice based on platform
- ✅ Attribute Seattle Parks visibly
- ⚠️ Treat the URL as ephemeral — Seattle Parks owns the dashboard and can change/revoke it. Wrap your fetch/embed in error handling and degrade to a plain link.

**Minimum embed code** (if you do choose to embed):

```html
<iframe
  src="<url from metadata.external_resources.seattle_parks_availability_dashboard.url>"
  width="100%"
  height="600"
  frameborder="0"
  allowfullscreen
  loading="lazy">
</iframe>
```

For React/Next.js with lazy loading:

```tsx
function AvailabilityDashboardButton({ facility, dashboardUrl }: {
  facility: Facility;
  dashboardUrl: string;
}) {
  const [open, setOpen] = useState(false);

  // Only show on reservable Seattle Parks venues
  const isCovered =
    facility.managedBy === 'Seattle Parks & Recreation' &&
    facility.bookingUrl != null;
  if (!isCovered) return null;

  return (
    <>
      <button onClick={() => setOpen(true)}>📊 Check court availability</button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <iframe src={dashboardUrl} className="w-full h-[80vh]" loading="lazy" />
          <p className="text-xs">Powered by Seattle Parks &amp; Recreation</p>
        </Modal>
      )}
    </>
  );
}
```
