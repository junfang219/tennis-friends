import { NextRequest, NextResponse } from "next/server";
import { fetchBookableCourts, fetchCourtDetail } from "@/lib/activenet";

// Seattle courts data (same source as /api/courts)
const SEATTLE_COURTS = [
  { id: "sea-1",  name: "Madrona Playground",           lat: 47.6114, lng: -122.2901, courts: 2,  address: "3211 E Spring St",                  surface: "hard", lit: true  },
  { id: "sea-2",  name: "Ravenna Park",                 lat: 47.6694, lng: -122.3029, courts: 2,  address: "5520 Ravenna Ave NE",               surface: "hard", lit: false },
  { id: "sea-3",  name: "Solstice Park",                lat: 47.5365, lng: -122.3917, courts: 6,  address: "7400 Fauntleroy Way SW",            surface: "hard", lit: true  },
  { id: "sea-4",  name: "Hiawatha Playfield",           lat: 47.5790, lng: -122.3852, courts: 3,  address: "2700 California Ave SW",            surface: "hard", lit: true  },
  { id: "sea-5",  name: "Madison Park",                 lat: 47.6349, lng: -122.2781, courts: 2,  address: "E Madison St / E Howe St",          surface: "hard", lit: false },
  { id: "sea-6",  name: "Magnolia Park",                lat: 47.6356, lng: -122.3975, courts: 2,  address: "1461 Magnolia Blvd W",              surface: "hard", lit: false },
  { id: "sea-7",  name: "Kinnear Park",                 lat: 47.6263, lng: -122.3649, courts: 1,  address: "899 W Olympic Pl",                  surface: "hard", lit: false },
  { id: "sea-8",  name: "Rogers Playground",             lat: 47.6429, lng: -122.3254, courts: 2,  address: "Eastlake Ave E / E Roanoke St",     surface: "hard", lit: false },
  { id: "sea-9",  name: "Pendleton Miller Playfield",   lat: 47.6208, lng: -122.3070, courts: 2,  address: "330 19th Ave E",                    surface: "hard", lit: true  },
  { id: "sea-10", name: "Seward Park",                  lat: 47.5482, lng: -122.2576, courts: 2,  address: "5898 Lake Washington Blvd S",       surface: "hard", lit: false },
  { id: "sea-11", name: "West Magnolia Playfield",      lat: 47.6410, lng: -122.4003, courts: 4,  address: "2518 34th Ave W",                   surface: "hard", lit: true  },
  { id: "sea-12", name: "Wallingford Playfield",        lat: 47.6584, lng: -122.3365, courts: 2,  address: "4219 Wallingford Ave N",            surface: "hard", lit: false },
  { id: "sea-13", name: "Bitter Lake Playfield",        lat: 47.7235, lng: -122.3498, courts: 4,  address: "13035 Linden Ave N",                surface: "hard", lit: true  },
  { id: "sea-14", name: "Brighton Playfield",           lat: 47.5479, lng: -122.2829, courts: 2,  address: "6000 39th Ave S",                   surface: "hard", lit: false },
  { id: "sea-15", name: "Sam Smith Park",               lat: 47.5900, lng: -122.2961, courts: 2,  address: "1400 Martin Luther King Jr Way S",  surface: "hard", lit: true  },
  { id: "sea-16", name: "Fred Hutchinson Playground",   lat: 47.5149, lng: -122.2604, courts: 2,  address: "S Norfolk St / 59th Ave S",         surface: "hard", lit: false },
  { id: "sea-17", name: "Montlake Playfield",           lat: 47.6414, lng: -122.3104, courts: 2,  address: "6118 E Calhoun St",                 surface: "hard", lit: false },
  { id: "sea-18", name: "Mount Baker Park",             lat: 47.5796, lng: -122.2885, courts: 2,  address: "2521 Lake Park Dr S",               surface: "hard", lit: false },
  { id: "sea-19", name: "Rainier Beach Playfield",      lat: 47.5240, lng: -122.2735, courts: 4,  address: "8802 Rainier Ave S",                surface: "hard", lit: true  },
  { id: "sea-20", name: "Highland Park Playground",     lat: 47.5268, lng: -122.3498, courts: 1,  address: "1100 SW Cloverdale St",             surface: "hard", lit: false },
  { id: "sea-21", name: "Discovery Park",               lat: 47.6568, lng: -122.4048, courts: 2,  address: "3801 W Government Way",             surface: "hard", lit: false },
  { id: "sea-22", name: "Warren G. Magnuson Park",      lat: 47.6814, lng: -122.2523, courts: 6,  address: "7400 Sand Point Way NE",            surface: "hard", lit: true  },
  { id: "sea-23", name: "Victory Heights Playground",   lat: 47.7059, lng: -122.3082, courts: 1,  address: "1737 NE 106th St",                  surface: "hard", lit: false },
  { id: "sea-24", name: "Green Lake Park (East)",       lat: 47.6815, lng: -122.3284, courts: 3,  address: "7201 E Green Lake Dr N",            surface: "hard", lit: true  },
  { id: "sea-25", name: "Alki Playground",              lat: 47.5792, lng: -122.4077, courts: 2,  address: "5817 SW Lander St",                 surface: "hard", lit: false },
  { id: "sea-26", name: "David Rodgers Park",           lat: 47.6448, lng: -122.3587, courts: 3,  address: "2800 1st Ave W",                    surface: "hard", lit: true  },
  { id: "sea-27", name: "Leschi Park",                  lat: 47.6014, lng: -122.2877, courts: 1,  address: "201 Lakeside Ave S",                surface: "hard", lit: false },
  { id: "sea-28", name: "Garfield Playfield",           lat: 47.6077, lng: -122.3003, courts: 2,  address: "23rd Ave / E Cherry St",            surface: "hard", lit: true  },
  { id: "sea-29", name: "Ravenna-Eckstein Park",        lat: 47.6764, lng: -122.3048, courts: 1,  address: "6535 Ravenna Ave NE",               surface: "hard", lit: false },
  { id: "sea-30", name: "Beacon Hill Playground",       lat: 47.5868, lng: -122.3156, courts: 2,  address: "1902 13th Ave S",                   surface: "hard", lit: true  },
  { id: "sea-31", name: "Laurelhurst Playfield",        lat: 47.6592, lng: -122.2789, courts: 4,  address: "4544 NE 41st St",                   surface: "hard", lit: true  },
  { id: "sea-32", name: "Delridge Playfield",           lat: 47.5633, lng: -122.3649, courts: 2,  address: "4458 Delridge Way SW",              surface: "hard", lit: false },
  { id: "sea-33", name: "University Playground",        lat: 47.6647, lng: -122.3199, courts: 2,  address: "9th Ave NE / NE 50th St",           surface: "hard", lit: false },
  { id: "sea-34", name: "Bryant Neighborhood Playground", lat: 47.6751, lng: -122.2840, courts: 2, address: "4103 NE 65th St",                  surface: "hard", lit: false },
  { id: "sea-35", name: "Froula Playground",            lat: 47.6806, lng: -122.3153, courts: 2,  address: "7200 12th Ave NE",                  surface: "hard", lit: false },
  { id: "sea-36", name: "Walt Hundley Playfield",       lat: 47.5403, lng: -122.3747, courts: 2,  address: "6920 34th Ave SW",                  surface: "hard", lit: false },
  { id: "sea-37", name: "Jefferson Park",               lat: 47.5701, lng: -122.3082, courts: 4,  address: "4165 16th Ave S",                   surface: "hard", lit: true  },
  { id: "sea-38", name: "South Park Playground",        lat: 47.5284, lng: -122.3252, courts: 1,  address: "738 S Sullivan St",                 surface: "hard", lit: false },
  { id: "sea-39", name: "Riverview Playfield",          lat: 47.5400, lng: -122.3499, courts: 2,  address: "7226 12th Ave SW",                  surface: "hard", lit: false },
  { id: "sea-40", name: "Georgetown Playfield",         lat: 47.5524, lng: -122.3221, courts: 1,  address: "750 S Homer St",                    surface: "hard", lit: false },
  { id: "sea-41", name: "Gilman Playground",            lat: 47.6670, lng: -122.3702, courts: 2,  address: "923 NW 54th St",                    surface: "hard", lit: true  },
  { id: "sea-42", name: "Rainier Playfield",            lat: 47.5625, lng: -122.2869, courts: 4,  address: "3700 S Alaska St",                  surface: "hard", lit: true  },
  { id: "sea-43", name: "Soundview Playfield",          lat: 47.6959, lng: -122.3805, courts: 2,  address: "1590 NW 90th St",                   surface: "hard", lit: false },
  { id: "sea-44", name: "Volunteer Park (Lower)",       lat: 47.6317, lng: -122.3175, courts: 2,  address: "1247 15th Ave E",                   surface: "hard", lit: false },
  { id: "sea-45", name: "Woodland Park (Upper)",        lat: 47.6642, lng: -122.3435, courts: 4,  address: "Aurora Ave N / N 59th St",          surface: "hard", lit: true  },
  { id: "sea-46", name: "Amy Yee Tennis Center",        lat: 47.5852, lng: -122.2976, courts: 6,  address: "2000 Martin Luther King Jr. Way S", surface: "indoor", lit: true },
  { id: "sea-47", name: "Dearborn Park",                lat: 47.5522, lng: -122.2951, courts: 2,  address: "9219 S Brandon St",                 surface: "hard", lit: false },
  { id: "sea-48", name: "Observatory Courts",           lat: 47.6316, lng: -122.3551, courts: 2,  address: "1405 Warren Ave N",                 surface: "hard", lit: false },
  { id: "sea-49", name: "Woodland Park (Lower)",        lat: 47.6693, lng: -122.3433, courts: 10, address: "1000 N 50th St",                    surface: "hard", lit: true  },
  { id: "sea-50", name: "Cal Anderson Park",            lat: 47.6158, lng: -122.3199, courts: 1,  address: "1635 11th Ave",                     surface: "hard", lit: true  },
  { id: "sea-51", name: "Green Lake Park (West)",       lat: 47.6812, lng: -122.3426, courts: 2,  address: "Green Lake Trail",                  surface: "hard", lit: false },
  { id: "sea-52", name: "Volunteer Park (Upper)",       lat: 47.6320, lng: -122.3180, courts: 2,  address: "1247 15th Ave E",                   surface: "hard", lit: false },
  { id: "sea-53", name: "Meadowbrook Playfield",        lat: 47.7062, lng: -122.2955, courts: 6,  address: "10533 35th Ave NE",                 surface: "hard", lit: true  },
];

// Map court names to ActiveNet resource IDs (populated lazily from ActiveNet API)
let activeNetMapping: Map<string, number> | null = null;

async function getActiveNetMapping(): Promise<Map<string, number>> {
  if (activeNetMapping) return activeNetMapping;
  try {
    const courts = await fetchBookableCourts();
    activeNetMapping = new Map();
    for (const c of courts) {
      activeNetMapping.set(c.name.toLowerCase(), c.id);
    }
    return activeNetMapping;
  } catch {
    return new Map();
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const court = SEATTLE_COURTS.find((c) => c.id === id);
  if (!court) {
    return NextResponse.json({ error: "Court not found" }, { status: 404 });
  }

  // Try to enrich with ActiveNet detail data
  let activeNetDetail = null;
  try {
    const mapping = await getActiveNetMapping();
    // Try matching by name (lowercase partial match)
    const courtNameLower = court.name.toLowerCase();
    let resourceId: number | undefined;
    for (const [name, rid] of mapping) {
      if (
        courtNameLower.includes(name) ||
        name.includes(courtNameLower) ||
        // Try matching key words
        courtNameLower.split(/\s+/).some((w) => w.length > 3 && name.includes(w))
      ) {
        resourceId = rid;
        break;
      }
    }
    if (resourceId) {
      activeNetDetail = await fetchCourtDetail(resourceId);
    }
  } catch {
    // ActiveNet enrichment is optional
  }

  return NextResponse.json({
    ...court,
    activeNet: activeNetDetail
      ? {
          phone: activeNetDetail.phone,
          description: activeNetDetail.description,
          minTime: activeNetDetail.minTime,
          maxTime: activeNetDetail.maxTime,
          maxCapacity: activeNetDetail.maxCapacity,
          openingHours: activeNetDetail.openingHours,
          amenities: activeNetDetail.amenities.map((a) => a.name),
          restrictions: activeNetDetail.restrictions,
        }
      : null,
  });
}
