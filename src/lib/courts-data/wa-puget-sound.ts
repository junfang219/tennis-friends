/**
 * Washington State — Puget Sound region tennis courts.
 *
 * Covers public tennis courts in Lynnwood, Mill Creek, Bothell, Woodinville,
 * Shoreline, Edmonds, Mountlake Terrace, Mukilteo, Everett, Marysville
 * (north); SeaTac, Burien, Tukwila, Des Moines, Kent, Renton, Federal Way,
 * Auburn (south King); Tacoma, Lakewood, University Place, Puyallup, Fife,
 * Gig Harbor (Pierce); Bainbridge Island, Bremerton, Poulsbo, Silverdale,
 * Port Orchard (Kitsap).
 *
 * Data derivation:
 *   1. Queried OpenStreetMap via Overpass for `leisure=pitch + sport=tennis`
 *      across the full Puget Sound bbox.
 *   2. Separately queried named `leisure=park` ways with bounding boxes.
 *   3. For each tennis pitch, spatial-joined to the smallest named park whose
 *      bbox contains it — yielding one entry per park with the count of
 *      pitches inside.
 *   4. Classified each park into a city via lat/lng bounding boxes.
 *   5. Excluded entries inside the existing Seattle and Eastside curated
 *      bboxes to avoid duplicates.
 *
 * Most city parks departments (Lynnwood, Bothell, Shoreline, SeaTac, Kent,
 * etc.) return 403 to automated WebFetch, so addresses are left empty for
 * these OSM-sourced entries. Court counts are the number of OSM pitches
 * inside the park's bbox — very large counts (>10 at a single park) should
 * be spot-checked since Overpass occasionally tags each half of a fenced
 * court as two separate pitches.
 */

import type { BBox, CuratedCourt } from "./types";

export const WA_PUGET_SOUND_BBOX: BBox = {
  south: 47.10,
  west: -122.80,
  north: 48.10,
  east: -121.95,
};

export const WA_PUGET_SOUND_COURTS: CuratedCourt[] = [
  // ===== Auburn =====
  { id: "wa-1",  name: "Les Gove / Mill Pond Park (Auburn)",       lat: 47.2675, lng: -122.2198, courts: 18, address: "" },
  { id: "wa-2",  name: "Auburn Game Farm Park (Auburn)",           lat: 47.2812, lng: -122.2059, courts: 12, address: "" },
  { id: "wa-3",  name: "Shaughnessy Park (Auburn)",                lat: 47.2903, lng: -122.1845, courts: 2,  address: "" },
  { id: "wa-4",  name: "Scootie Brown Park (Auburn)",              lat: 47.3146, lng: -122.2099, courts: 2,  address: "" },
  { id: "wa-5",  name: "Lea Hill Park (Auburn)",                   lat: 47.3142, lng: -122.2005, courts: 2,  address: "" },
  { id: "wa-6",  name: "Algona Park (Auburn)",                     lat: 47.2780, lng: -122.2492, courts: 2,  address: "" },

  // ===== Bainbridge Island =====
  { id: "wa-7",  name: "Sakai Park (Bainbridge Island)",           lat: 47.6382, lng: -122.5198, courts: 2,  address: "" },
  { id: "wa-8",  name: "Strawberry Hill Park (Bainbridge Island)", lat: 47.6375, lng: -122.5488, courts: 1,  address: "" },

  // ===== Bothell =====
  { id: "wa-9",  name: "Woodin Creek Park (Bothell)",              lat: 47.7501, lng: -122.1627, courts: 2,  address: "" },

  // ===== Bremerton =====
  { id: "wa-10", name: "Van Zee Park (Bremerton)",                 lat: 47.5249, lng: -122.6442, courts: 2,  address: "" },

  // ===== Burien =====
  { id: "wa-11", name: "Normandy Park Cove (Burien)",              lat: 47.4442, lng: -122.3526, courts: 2,  address: "" },
  { id: "wa-12", name: "Lake Burien School Memorial Park (Burien)", lat: 47.4697, lng: -122.3558, courts: 2,  address: "" },

  // ===== Des Moines =====
  { id: "wa-13", name: "West Fenwick Park (Des Moines)",           lat: 47.3712, lng: -122.2831, courts: 2,  address: "" },
  { id: "wa-14", name: "Field House Park (Des Moines)",            lat: 47.4053, lng: -122.3204, courts: 2,  address: "" },

  // ===== Edmonds =====
  { id: "wa-15", name: "Yost Park (Edmonds)",                      lat: 47.8072, lng: -122.3597, courts: 1,  address: "" },

  // ===== Everett =====
  { id: "wa-16", name: "Clark Park (Everett)",                     lat: 47.9851, lng: -122.2039, courts: 6,  address: "" },
  { id: "wa-17", name: "Garfield Park (Everett)",                  lat: 47.9860, lng: -122.1876, courts: 1,  address: "" },
  { id: "wa-18", name: "Lowell Park (Everett)",                    lat: 47.9578, lng: -122.1966, courts: 1,  address: "" },
  { id: "wa-19", name: "Forest Park (Everett)",                    lat: 47.9597, lng: -122.2197, courts: 1,  address: "" },
  { id: "wa-20", name: "American Legion Memorial Park (Everett)",  lat: 48.0146, lng: -122.2035, courts: 1,  address: "" },

  // ===== Federal Way =====
  { id: "wa-21", name: "Five Mile Lake Park (Federal Way)",        lat: 47.2741, lng: -122.2803, courts: 4,  address: "" },
  { id: "wa-22", name: "Sacajawea Park (Federal Way)",             lat: 47.3348, lng: -122.3163, courts: 4,  address: "" },
  { id: "wa-23", name: "Saghalie Park (Federal Way)",              lat: 47.2987, lng: -122.3523, courts: 2,  address: "" },
  { id: "wa-24", name: "Alderdale Park (Federal Way)",             lat: 47.2982, lng: -122.3671, courts: 2,  address: "" },
  { id: "wa-25", name: "Southwest 312th Sports Courts (Federal Way)", lat: 47.3226, lng: -122.3493, courts: 2, address: "" },
  { id: "wa-26", name: "Adelaide Park (Federal Way)",              lat: 47.3276, lng: -122.3568, courts: 2,  address: "" },
  { id: "wa-27", name: "Celebration Park (Federal Way)",           lat: 47.3112, lng: -122.3199, courts: 2,  address: "" },
  { id: "wa-28", name: "The Park (Federal Way)",                   lat: 47.3027, lng: -122.3421, courts: 2,  address: "" },

  // ===== Gig Harbor =====
  { id: "wa-29", name: "Peninsula Recreation Area (Gig Harbor)",   lat: 47.3331, lng: -122.6058, courts: 4,  address: "" },
  { id: "wa-30", name: "Crescent Creek Park (Gig Harbor)",         lat: 47.3457, lng: -122.5812, courts: 1,  address: "" },

  // ===== Kent =====
  { id: "wa-31", name: "Mill Creek Earthworks Park (Kent)",        lat: 47.3754, lng: -122.2061, courts: 9,  address: "" },
  { id: "wa-32", name: "Scenic Hill Park (Kent)",                  lat: 47.3702, lng: -122.2120, courts: 5,  address: "" },
  { id: "wa-33", name: "Garrison Creek Park (Kent)",               lat: 47.4061, lng: -122.2107, courts: 5,  address: "" },
  { id: "wa-34", name: "Kent Memorial Park (Kent)",                lat: 47.3905, lng: -122.2305, courts: 2,  address: "" },
  { id: "wa-35", name: "Turnkey Park (Kent)",                      lat: 47.3940, lng: -122.2051, courts: 2,  address: "" },
  { id: "wa-36", name: "Glenn Nelson Park (Kent)",                 lat: 47.3624, lng: -122.2913, courts: 2,  address: "" },
  { id: "wa-37", name: "Morrill Meadows Park (Kent)",              lat: 47.3808, lng: -122.1967, courts: 1,  address: "" },

  // ===== Lynnwood =====
  { id: "wa-38", name: "Lynndale Park (Lynnwood)",                 lat: 47.8282, lng: -122.3313, courts: 4,  address: "" },
  { id: "wa-39", name: "Evergreen Playfield (Lynnwood)",           lat: 47.7961, lng: -122.3066, courts: 4,  address: "" },
  { id: "wa-40", name: "Pioneer Park (Lynnwood)",                  lat: 47.8326, lng: -122.2840, courts: 2,  address: "" },
  { id: "wa-41", name: "Ballinger Park (Lynnwood)",                lat: 47.7918, lng: -122.3284, courts: 2,  address: "" },
  { id: "wa-42", name: "Seaview Park (Lynnwood)",                  lat: 47.8310, lng: -122.3421, courts: 2,  address: "" },
  { id: "wa-43", name: "Brier City Park (Lynnwood)",               lat: 47.7923, lng: -122.2664, courts: 2,  address: "" },
  { id: "wa-44", name: "South Lynnwood Neighborhood Park (Lynnwood)", lat: 47.8082, lng: -122.3149, courts: 1, address: "" },

  // ===== Mill Creek =====
  { id: "wa-45", name: "Highlands Park (Mill Creek)",              lat: 47.8509, lng: -122.1942, courts: 1,  address: "" },
  { id: "wa-46", name: "Heron Park (Mill Creek)",                  lat: 47.8580, lng: -122.1952, courts: 1,  address: "" },

  // ===== Puyallup =====
  { id: "wa-47", name: "Clark's Creek Park (Puyallup)",            lat: 47.1845, lng: -122.3208, courts: 4,  address: "", lit: true },
  { id: "wa-48", name: "Puyallup Valley Sports Complex (Puyallup)", lat: 47.2089, lng: -122.3047, courts: 1, address: "" },

  // ===== Renton =====
  { id: "wa-49", name: "Talbot Hill Reservoir Park (Renton)",      lat: 47.4619, lng: -122.2088, courts: 3,  address: "" },
  { id: "wa-50", name: "Liberty Park (Renton)",                    lat: 47.4829, lng: -122.2007, courts: 3,  address: "" },
  { id: "wa-51", name: "Highlands Neighborhood Park (Renton)",     lat: 47.4952, lng: -122.1841, courts: 2,  address: "" },
  { id: "wa-52", name: "Tiffany Park (Renton)",                    lat: 47.4626, lng: -122.1773, courts: 2,  address: "" },
  { id: "wa-53", name: "Kiwanis Park (Renton)",                    lat: 47.4973, lng: -122.1652, courts: 2,  address: "" },
  { id: "wa-54", name: "Phillip Arnold Park (Renton)",             lat: 47.4710, lng: -122.1961, courts: 2,  address: "", lit: true },

  // ===== SeaTac =====
  { id: "wa-55", name: "Tukwila Park (SeaTac)",                    lat: 47.4638, lng: -122.2512, courts: 3,  address: "" },
  { id: "wa-56", name: "Valley Ridge Park (SeaTac)",               lat: 47.4355, lng: -122.2758, courts: 2,  address: "" },
  { id: "wa-57", name: "Crystal Springs Park (SeaTac)",            lat: 47.4601, lng: -122.2685, courts: 1,  address: "" },

  // ===== Tacoma =====
  { id: "wa-58", name: "Stewart Heights Park (Tacoma)",            lat: 47.2053, lng: -122.4257, courts: 4,  address: "" },
  { id: "wa-59", name: "South End Recreation & Adventure (Tacoma)", lat: 47.1978, lng: -122.4902, courts: 4, address: "" },
  { id: "wa-60", name: "Gene Goodwin Memorial Park (Tacoma)",      lat: 47.2330, lng: -122.5119, courts: 3,  address: "" },
  { id: "wa-61", name: "Whittier Park (Tacoma)",                   lat: 47.2298, lng: -122.5122, courts: 3,  address: "" },
  { id: "wa-62", name: "Jefferson Park (Tacoma)",                  lat: 47.2576, lng: -122.4935, courts: 3,  address: "" },
  { id: "wa-63", name: "Titlow Park (Tacoma)",                     lat: 47.2472, lng: -122.5503, courts: 2,  address: "" },
  { id: "wa-64", name: "Browns Point Playfield (Tacoma)",          lat: 47.3022, lng: -122.4403, courts: 2,  address: "" },
  { id: "wa-65", name: "Vassault Park (Tacoma)",                   lat: 47.2806, lng: -122.5208, courts: 2,  address: "" },
  { id: "wa-66", name: "Verlo Playfield (Tacoma)",                 lat: 47.2175, lng: -122.4184, courts: 2,  address: "" },
  { id: "wa-67", name: "Alling Park (Tacoma)",                     lat: 47.2035, lng: -122.4510, courts: 1,  address: "" },
  { id: "wa-68", name: "Cloverdale Park (Tacoma)",                 lat: 47.2041, lng: -122.4055, courts: 1,  address: "" },
  { id: "wa-69", name: "Portland Avenue Park (Tacoma)",            lat: 47.2305, lng: -122.4060, courts: 1,  address: "" },
];
