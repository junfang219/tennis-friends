/**
 * Portland OR metro tennis courts.
 *
 * Cities covered: Portland, Beaverton, Hillsboro, Tigard, Tualatin,
 * Lake Oswego, West Linn, Milwaukie, Gresham, Oregon City, Vancouver WA,
 * Camas WA.
 *
 * Data derivation (same approach as wa-puget-sound.ts):
 *   1. Queried OpenStreetMap via Overpass for leisure=pitch + sport=tennis
 *      across the Portland metro bbox.
 *   2. Separately queried named leisure=park ways with bounding boxes.
 *   3. For each tennis pitch, spatial-joined to the smallest named park
 *      whose bbox contains it.
 *   4. Classified each park by city via lat/lng bounding boxes.
 *
 * Addresses are empty because OSM doesn't have park addresses and the
 * Portland Parks & Recreation directory (portland.gov/parks/tennis)
 * returns 404 to automated WebFetch. Court counts may occasionally
 * overcount when OSM tags individual court halves as separate pitches.
 */

import type { BBox, CuratedCourt } from "./types";

export const PDX_METRO_BBOX: BBox = {
  south: 45.30,
  west: -123.00,
  north: 45.75,
  east: -122.35,
};

export const PDX_METRO_COURTS: CuratedCourt[] = [
// ----- Beaverton -----
  { id: "pdx-16", name: "Oak Hills Neighborhood Park (Beaverton)"                 , lat: 45.5377, lng: -122.8342, courts: 4, address: "", lit: true },
  { id: "pdx-15", name: "Terra Linda Park (Beaverton)"                            , lat: 45.5352, lng: -122.8197, courts: 3, address: "" },
  { id: "pdx-17", name: "Somerset West Swim Center/Park (Beaverton)"              , lat: 45.5447, lng: -122.8654, courts: 2, address: "" },
  { id: "pdx-18", name: "Somerset Meadows Park (Beaverton)"                       , lat: 45.5454, lng: -122.8525, courts: 2, address: "" },
  { id: "pdx-43", name: "Ridgecrest Park (Beaverton)"                             , lat: 45.465, lng: -122.8013, courts: 2, address: "" },
  { id: "pdx-47", name: "Hazeldale Park (Beaverton)"                              , lat: 45.4785, lng: -122.8775, courts: 2, address: "" },
  { id: "pdx-5", name: "Magnolia Park (Beaverton)"                               , lat: 45.5327, lng: -122.8731, courts: 1, address: "" },
  { id: "pdx-51", name: "Barsotti Park (Beaverton)"                               , lat: 45.4893, lng: -122.8474, courts: 1, address: "" },

  // ----- Camas WA -----
  { id: "pdx-30", name: "Crown Park (Camas WA)"                                   , lat: 45.5914, lng: -122.4092, courts: 2, address: "" },
  { id: "pdx-8", name: "Grass Valley Park (Camas WA)"                            , lat: 45.6072, lng: -122.442, courts: 1, address: "" },

  // ----- Gresham -----
  { id: "pdx-7", name: "Lewellyn Park (Gresham)"                                 , lat: 45.5285, lng: -122.3758, courts: 2, address: "" },
  { id: "pdx-40", name: "Weedin Park (Gresham)"                                   , lat: 45.5326, lng: -122.3835, courts: 1, address: "" },

  // ----- Hillsboro -----
  { id: "pdx-6", name: "Turner Creek Park (Hillsboro)"                           , lat: 45.5137, lng: -122.9536, courts: 2, address: "" },
  { id: "pdx-19", name: "Bethany Lake Park (Hillsboro)"                           , lat: 45.5557, lng: -122.8765, courts: 2, address: "" },
  { id: "pdx-20", name: "Hidden Creek Park East (Hillsboro)"                      , lat: 45.5239, lng: -122.928, courts: 2, address: "", lit: true },
  { id: "pdx-21", name: "Reedville Creek Park (Hillsboro)"                        , lat: 45.5084, lng: -122.9035, courts: 2, address: "" },
  { id: "pdx-71", name: "Cross Creek South Park (Hillsboro)"                      , lat: 45.471, lng: -122.8905, courts: 1, address: "" },

  // ----- Lake Oswego -----
  { id: "pdx-53", name: "George Rogers Park (Lake Oswego)"                        , lat: 45.4119, lng: -122.6623, courts: 2, address: "" },
  { id: "pdx-44", name: "Westlake Park (Lake Oswego)"                             , lat: 45.4252, lng: -122.7254, courts: 1, address: "" },
  { id: "pdx-67", name: "Skyline Ridge Park (Lake Oswego)"                        , lat: 45.3902, lng: -122.6632, courts: 1, address: "" },
  { id: "pdx-78", name: "South Shore Tennis Courts (Lake Oswego)"                 , lat: 45.4063, lng: -122.6802, courts: 1, address: "" },

  // ----- Milwaukie -----
  { id: "pdx-81", name: "Century Park (Milwaukie)"                                , lat: 45.4398, lng: -122.6265, courts: 1, address: "" },

  // ----- Oregon City -----
  { id: "pdx-55", name: "Hillendale Park (Oregon City)"                           , lat: 45.3302, lng: -122.597, courts: 1, address: "" },

  // ----- Portland -----
  { id: "pdx-26", name: "Grant Park (Portland)"                                   , lat: 45.5399, lng: -122.6294, courts: 6, address: "", lit: true },
  { id: "pdx-23", name: "Argay Park (Portland)"                                   , lat: 45.5521, lng: -122.5191, courts: 4, address: "" },
  { id: "pdx-27", name: "Clinton Park (Portland)"                                 , lat: 45.5018, lng: -122.6052, courts: 4, address: "" },
  { id: "pdx-28", name: "Glenhaven Park (Portland)"                               , lat: 45.5432, lng: -122.5826, courts: 4, address: "" },
  { id: "pdx-35", name: "Irving Park (Portland)"                                  , lat: 45.5462, lng: -122.6579, courts: 4, address: "", lit: true },
  { id: "pdx-52", name: "Greenway Park (Portland)"                                , lat: 45.4535, lng: -122.7982, courts: 4, address: "" },
  { id: "pdx-57", name: "Camille Park (Portland)"                                 , lat: 45.4648, lng: -122.7835, courts: 4, address: "" },
  { id: "pdx-63", name: "Gabriel Park (Portland)"                                 , lat: 45.4738, lng: -122.7211, courts: 4, address: "", lit: true },
  { id: "pdx-70", name: "Willamette Park (Portland)"                              , lat: 45.4742, lng: -122.6704, courts: 4, address: "", lit: true },
  { id: "pdx-76", name: "Sellwood Park (Portland)"                                , lat: 45.4665, lng: -122.6608, courts: 4, address: "" },
  { id: "pdx-1", name: "Alberta Park (Portland)"                                 , lat: 45.5636, lng: -122.6448, courts: 2, address: "" },
  { id: "pdx-3", name: "Lair Hill Park (Portland)"                               , lat: 45.5021, lng: -122.6809, courts: 2, address: "" },
  { id: "pdx-9", name: "Fisher Basin Park (Portland)"                            , lat: 45.6166, lng: -122.4743, courts: 2, address: "" },
  { id: "pdx-10", name: "Peninsula Park (Portland)"                               , lat: 45.5694, lng: -122.6727, courts: 2, address: "" },
  { id: "pdx-12", name: "Northgate Park (Portland)"                               , lat: 45.5896, lng: -122.7246, courts: 2, address: "", lit: true },
  { id: "pdx-13", name: "Rose City Park (Portland)"                               , lat: 45.5387, lng: -122.5985, courts: 2, address: "" },
  { id: "pdx-14", name: "Cedar Mill Park (Portland)"                              , lat: 45.528, lng: -122.784, courts: 2, address: "" },
  { id: "pdx-22", name: "Colonel Summers Park (Portland)"                         , lat: 45.5162, lng: -122.6468, courts: 2, address: "" },
  { id: "pdx-24", name: "Lost Park (Portland)"                                    , lat: 45.5346, lng: -122.7901, courts: 2, address: "" },
  { id: "pdx-25", name: "Mitchell Park (Portland)"                                , lat: 45.5211, lng: -122.7743, courts: 2, address: "", lit: true },
  { id: "pdx-29", name: "West Sylvan Park (Portland)"                             , lat: 45.5037, lng: -122.7611, courts: 2, address: "" },
  { id: "pdx-31", name: "Parklane Park (Portland)"                                , lat: 45.5135, lng: -122.5042, courts: 2, address: "" },
  { id: "pdx-32", name: "Roxbury Park (Portland)"                                 , lat: 45.5021, lng: -122.788, courts: 2, address: "" },
  { id: "pdx-33", name: "Forest Hills Park (Portland)"                            , lat: 45.5123, lng: -122.7919, courts: 2, address: "" },
  { id: "pdx-34", name: "Arbor Lodge Park (Portland)"                             , lat: 45.5732, lng: -122.6937, courts: 2, address: "" },
  { id: "pdx-36", name: "Fernhill Park (Portland)"                                , lat: 45.5676, lng: -122.6251, courts: 2, address: "" },
  { id: "pdx-37", name: "Columbia Park (Portland)"                                , lat: 45.5803, lng: -122.7096, courts: 2, address: "", lit: true },
  { id: "pdx-38", name: "Laurelhurst Park (Portland)"                             , lat: 45.52, lng: -122.6254, courts: 2, address: "", lit: true },
  { id: "pdx-39", name: "Oakbrook Park (Portland)"                                , lat: 45.646, lng: -122.5701, courts: 2, address: "" },
  { id: "pdx-41", name: "Westmoreland Park (Portland)"                            , lat: 45.4738, lng: -122.6408, courts: 2, address: "" },
  { id: "pdx-49", name: "Brooklyn School Park (Portland)"                         , lat: 45.4951, lng: -122.6498, courts: 2, address: "" },
  { id: "pdx-56", name: "Garden Home Park (Portland)"                             , lat: 45.4617, lng: -122.7611, courts: 2, address: "" },
  { id: "pdx-58", name: "Raleigh Park and Swim Center (Portland)"                 , lat: 45.4947, lng: -122.7558, courts: 2, address: "" },
  { id: "pdx-59", name: "Berkeley Park (Portland)"                                , lat: 45.4727, lng: -122.6231, courts: 2, address: "" },
  { id: "pdx-61", name: "Vista Brook Park (Portland)"                             , lat: 45.4712, lng: -122.7676, courts: 2, address: "" },
  { id: "pdx-64", name: "Lents Park (Portland)"                                   , lat: 45.4856, lng: -122.57, courts: 2, address: "" },
  { id: "pdx-65", name: "Kenilworth Park (Portland)"                              , lat: 45.4909, lng: -122.6323, courts: 2, address: "", lit: true },
  { id: "pdx-69", name: "Hamilton Park (Portland)"                                , lat: 45.4919, lng: -122.7211, courts: 2, address: "" },
  { id: "pdx-72", name: "McMillan Park (Portland)"                                , lat: 45.4846, lng: -122.7774, courts: 2, address: "" },
  { id: "pdx-73", name: "Brentwood Park (Portland)"                               , lat: 45.4725, lng: -122.6017, courts: 2, address: "" },
  { id: "pdx-74", name: "Happy Valley Park (Portland)"                            , lat: 45.4536, lng: -122.5214, courts: 2, address: "" },
  { id: "pdx-75", name: "Essex Park (Portland)"                                   , lat: 45.4941, lng: -122.5843, courts: 2, address: "", lit: true },
  { id: "pdx-79", name: "Mount Scott Park (Portland)"                             , lat: 45.4811, lng: -122.5879, courts: 2, address: "" },
  { id: "pdx-2", name: "Portland Heights Park (Portland)"                        , lat: 45.5039, lng: -122.708, courts: 1, address: "" },
  { id: "pdx-4", name: "Hillside Park (Portland)"                                , lat: 45.5275, lng: -122.7094, courts: 1, address: "" },
  { id: "pdx-42", name: "Burlingame Park (Portland)"                              , lat: 45.4679, lng: -122.6906, courts: 1, address: "" },
  { id: "pdx-50", name: "Pendleton Park (Portland)"                               , lat: 45.4807, lng: -122.7331, courts: 1, address: "" },
  { id: "pdx-54", name: "Woodstock Park (Portland)"                               , lat: 45.483, lng: -122.6111, courts: 1, address: "" },

  // ----- Tigard -----
  { id: "pdx-46", name: "Summerlake Park (Tigard)"                                , lat: 45.438, lng: -122.8113, courts: 2, address: "" },
  { id: "pdx-62", name: "Metzger Park (Tigard)"                                   , lat: 45.449, lng: -122.7619, courts: 2, address: "" },

  // ----- Tualatin -----
  { id: "pdx-45", name: "Jurgens Park (Tualatin)"                                 , lat: 45.3967, lng: -122.7836, courts: 2, address: "" },
  { id: "pdx-48", name: "Atfalati Park (Tualatin)"                                , lat: 45.3733, lng: -122.7456, courts: 2, address: "" },
  { id: "pdx-60", name: "Ibach Park (Tualatin)"                                   , lat: 45.3618, lng: -122.7828, courts: 2, address: "" },
  { id: "pdx-68", name: "Tualatin Community Park (Tualatin)"                      , lat: 45.3856, lng: -122.7632, courts: 2, address: "" },

  // ----- Vancouver WA -----
  { id: "pdx-11", name: "Mount Vista Assosiation Park (Vancouver WA)"             , lat: 45.7343, lng: -122.647, courts: 2, address: "" },

  // ----- West Linn -----
  { id: "pdx-77", name: "Risley Park (West Linn)"                                 , lat: 45.4075, lng: -122.6393, courts: 2, address: "" },
  { id: "pdx-82", name: "Rivercrest Park (West Linn)"                             , lat: 45.3447, lng: -122.6077, courts: 2, address: "" },
  { id: "pdx-66", name: "Sunset Park (West Linn)"                                 , lat: 45.3594, lng: -122.6246, courts: 1, address: "" },
  { id: "pdx-80", name: "North Willamette Neighborhood Park (West Linn)"          , lat: 45.3554, lng: -122.6572, courts: 1, address: "" },
];
