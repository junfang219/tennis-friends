/**
 * Greater San Francisco Bay Area tennis courts.
 *
 * Cities covered: San Francisco, Berkeley, Oakland, Palo Alto, Mountain View,
 * Sunnyvale, Cupertino, San Jose.
 *
 * Sources: each city's parks-department facility directory (SF Rec & Parks,
 * Berkeley Parks, Palo Alto Parks, Mountain View Parks, Sunnyvale Parks,
 * Cupertino Parks, San Jose PRNS, Oakland Parks & Rec). Oakland and San Jose
 * partially gated behind booking systems — supplemented from public Yelp /
 * Tennis Coalition SF listings. Coordinates geocoded to ~4 decimal accuracy.
 */

import type { BBox, CuratedCourt } from "./types";

export const BAY_AREA_BBOX: BBox = {
  south: 37.20,
  west: -122.60,
  north: 38.05,
  east: -121.80,
};

export const BAY_AREA_COURTS: CuratedCourt[] = [
  // ===== San Francisco =====
  { id: "bay-1",  name: "Lisa & Douglas Goldman Tennis Center (Golden Gate Park)", lat: 37.7694, lng: -122.4575, courts: 16, address: "742 Bowling Green Dr, San Francisco, CA 94118" },
  { id: "bay-2",  name: "Dolores Park Tennis Courts",                              lat: 37.7596, lng: -122.4270, courts: 6,  address: "18th St & Dolores St, San Francisco, CA 94114" },
  { id: "bay-3",  name: "Alice Marble Tennis Courts",                              lat: 37.8018, lng: -122.4186, courts: 4,  address: "Greenwich St & Hyde St, San Francisco, CA 94109" },
  { id: "bay-4",  name: "Alta Plaza Park Tennis Courts",                           lat: 37.7916, lng: -122.4356, courts: 4,  address: "Jackson St & Steiner St, San Francisco, CA 94115" },
  { id: "bay-5",  name: "Moscone Recreation Center Tennis Courts",                 lat: 37.8020, lng: -122.4362, courts: 4,  address: "1800 Chestnut St, San Francisco, CA 94123" },
  { id: "bay-6",  name: "Hamilton Recreation Center Tennis Courts",                lat: 37.7839, lng: -122.4369, courts: 2,  address: "1900 Geary Blvd, San Francisco, CA 94115" },
  { id: "bay-7",  name: "Joe DiMaggio Playground Tennis Courts",                   lat: 37.8037, lng: -122.4117, courts: 3,  address: "651 Lombard St, San Francisco, CA 94133" },
  { id: "bay-8",  name: "Crocker Amazon Playground Tennis Courts",                 lat: 37.7121, lng: -122.4389, courts: 3,  address: "799 Moscow St, San Francisco, CA 94112" },
  { id: "bay-9",  name: "Glen Canyon Park Tennis Courts",                          lat: 37.7345, lng: -122.4394, courts: 2,  address: "Elk St & Chenery St, San Francisco, CA 94131" },
  { id: "bay-10", name: "Jackson Playground Tennis Court",                         lat: 37.7638, lng: -122.3995, courts: 1,  address: "17th St & Arkansas St, San Francisco, CA 94107" },
  { id: "bay-11", name: "Buena Vista Park Tennis Courts",                          lat: 37.7689, lng: -122.4411, courts: 2,  address: "Haight St & Buena Vista Ave W, San Francisco, CA 94117" },
  { id: "bay-12", name: "Mountain Lake Park Tennis Courts",                        lat: 37.7862, lng: -122.4691, courts: 4,  address: "12th Ave & Lake St, San Francisco, CA 94118" },
  { id: "bay-13", name: "Presidio Wall Playground Tennis Courts",                  lat: 37.7878, lng: -122.4467, courts: 2,  address: "Pacific Ave & Walnut St, San Francisco, CA 94115" },
  { id: "bay-14", name: "Upper Noe Recreation Center Tennis Courts",               lat: 37.7428, lng: -122.4287, courts: 2,  address: "295 Day St, San Francisco, CA 94131" },
  { id: "bay-15", name: "Richmond Recreation Center Tennis Courts",                lat: 37.7806, lng: -122.4639, courts: 2,  address: "251 18th Ave, San Francisco, CA 94121" },
  { id: "bay-16", name: "Rossi Playground Tennis Courts",                          lat: 37.7799, lng: -122.4592, courts: 2,  address: "600 Arguello Blvd, San Francisco, CA 94118" },
  { id: "bay-17", name: "Sunset Recreation Center Tennis Courts",                  lat: 37.7516, lng: -122.4827, courts: 2,  address: "2201 Lawton St, San Francisco, CA 94122" },
  { id: "bay-18", name: "West Sunset Playground Tennis Courts",                    lat: 37.7530, lng: -122.4956, courts: 2,  address: "3223 Ortega St, San Francisco, CA 94122" },
  { id: "bay-19", name: "McLaren Park Tennis Courts",                              lat: 37.7206, lng: -122.4178, courts: 4,  address: "Mansell St & Visitacion Ave, San Francisco, CA 94134" },

  // ===== Berkeley =====
  { id: "bay-20", name: "San Pablo Park",          lat: 37.8567, lng: -122.2876, courts: 6, address: "2800 Park St, Berkeley, CA 94702" },
  { id: "bay-21", name: "Live Oak Park",           lat: 37.8786, lng: -122.2695, courts: 2, address: "1301 Shattuck Ave, Berkeley, CA 94709" },
  { id: "bay-22", name: "Willard Park",            lat: 37.8617, lng: -122.2592, courts: 2, address: "2727 Hillegass Ave, Berkeley, CA 94705" },
  { id: "bay-23", name: "James Kenney Park",       lat: 37.8712, lng: -122.2956, courts: 2, address: "1720 8th St, Berkeley, CA 94710" },
  { id: "bay-24", name: "Cedar Rose Park",         lat: 37.8803, lng: -122.2850, courts: 2, address: "1300 Rose St, Berkeley, CA 94702" },
  { id: "bay-25", name: "Strawberry Creek Park",   lat: 37.8693, lng: -122.2905, courts: 2, address: "1260 Allston Way, Berkeley, CA 94702" },
  { id: "bay-26", name: "King School Park",        lat: 37.8712, lng: -122.2760, courts: 4, address: "1781 Rose St, Berkeley, CA 94703" },

  // ===== Oakland =====
  { id: "bay-27", name: "Davie Tennis Stadium",              lat: 37.8122, lng: -122.2466, courts: 5, address: "198 Oak Rd, Oakland, CA 94610" },
  { id: "bay-28", name: "Bushrod Recreation Center",         lat: 37.8413, lng: -122.2654, courts: 3, address: "560 59th St, Oakland, CA 94609" },
  { id: "bay-29", name: "Mosswood Park",                     lat: 37.8194, lng: -122.2632, courts: 3, address: "3612 Webster St, Oakland, CA 94609" },
  { id: "bay-30", name: "Dimond Park",                       lat: 37.7984, lng: -122.2094, courts: 2, address: "3751 Fruitvale Ave, Oakland, CA 94602" },
  { id: "bay-31", name: "Montclair Recreation Center",       lat: 37.8269, lng: -122.2098, courts: 4, address: "6300 Moraga Ave, Oakland, CA 94611" },
  { id: "bay-32", name: "Joaquin Miller Park",               lat: 37.8131, lng: -122.1857, courts: 2, address: "3594 Sanborn Dr, Oakland, CA 94602" },
  { id: "bay-33", name: "Redwood Heights Recreation Center", lat: 37.7933, lng: -122.1904, courts: 2, address: "3883 Aliso Ave, Oakland, CA 94619" },
  { id: "bay-34", name: "Allendale Recreation Center",       lat: 37.7791, lng: -122.1965, courts: 2, address: "3711 Suter St, Oakland, CA 94619" },

  // ===== Palo Alto =====
  { id: "bay-35", name: "Rinconada Park",  lat: 37.4456, lng: -122.1422, courts: 6, address: "777 Embarcadero Rd, Palo Alto, CA 94301" },
  { id: "bay-36", name: "Mitchell Park",   lat: 37.4197, lng: -122.1126, courts: 7, address: "600 E Meadow Dr, Palo Alto, CA 94306" },
  { id: "bay-37", name: "Hoover Park",     lat: 37.4268, lng: -122.1262, courts: 2, address: "2901 Cowper St, Palo Alto, CA 94306" },
  { id: "bay-38", name: "Peers Park",      lat: 37.4235, lng: -122.1365, courts: 2, address: "1899 Park Blvd, Palo Alto, CA 94306" },
  { id: "bay-39", name: "Weisshaar Park",  lat: 37.4309, lng: -122.1038, courts: 2, address: "3951 Nelson Dr, Palo Alto, CA 94303" },
  { id: "bay-40", name: "Terman Park",     lat: 37.4067, lng: -122.1381, courts: 2, address: "655 Arastradero Rd, Palo Alto, CA 94306" },

  // ===== Mountain View =====
  { id: "bay-41", name: "Cuesta Tennis Center", lat: 37.3831, lng: -122.0986, courts: 12, address: "615 Cuesta Dr, Mountain View, CA 94040" },
  { id: "bay-42", name: "Rengstorff Park",      lat: 37.4031, lng: -122.0949, courts: 8,  address: "201 S Rengstorff Ave, Mountain View, CA 94040" },
  { id: "bay-43", name: "Stevenson Park",       lat: 37.3917, lng: -122.0816, courts: 2,  address: "750 San Pierre Way, Mountain View, CA 94043" },
  { id: "bay-44", name: "Cooper Park",          lat: 37.4105, lng: -122.0769, courts: 2,  address: "500 Chesley Ave, Mountain View, CA 94043" },
  { id: "bay-45", name: "Sylvan Park",          lat: 37.3989, lng: -122.0720, courts: 2,  address: "550 Sylvan Ave, Mountain View, CA 94041" },
  { id: "bay-46", name: "Whisman Park",         lat: 37.4014, lng: -122.0613, courts: 4,  address: "330 Easy St, Mountain View, CA 94043" },

  // ===== Sunnyvale =====
  { id: "bay-47", name: "Las Palmas Park Tennis Center", lat: 37.3488, lng: -122.0299, courts: 16, address: "755 S Mathilda Ave, Sunnyvale, CA 94087" },
  { id: "bay-48", name: "Ortega Park",                   lat: 37.3654, lng: -122.0208, courts: 2,  address: "636 Harrow Way, Sunnyvale, CA 94087" },
  { id: "bay-49", name: "Washington Park",               lat: 37.3767, lng: -122.0311, courts: 2,  address: "840 W Washington Ave, Sunnyvale, CA 94086" },
  { id: "bay-50", name: "De Anza Park",                  lat: 37.3566, lng: -122.0149, courts: 2,  address: "1150 Lochinvar Ave, Sunnyvale, CA 94087" },

  // ===== Cupertino =====
  { id: "bay-51", name: "Cupertino Sports Center", lat: 37.3226, lng: -122.0344, courts: 17, address: "21111 Stevens Creek Blvd, Cupertino, CA 95014" },
  { id: "bay-52", name: "Memorial Park",           lat: 37.3245, lng: -122.0384, courts: 6,  address: "10185 N Stelling Rd, Cupertino, CA 95014" },
  { id: "bay-53", name: "Monta Vista Park",        lat: 37.3090, lng: -122.0547, courts: 2,  address: "22601 Voss Ave, Cupertino, CA 95014" },
  { id: "bay-54", name: "Varian Park",             lat: 37.3168, lng: -122.0473, courts: 2,  address: "10056 Varian Way, Cupertino, CA 95014" },

  // ===== San Jose =====
  { id: "bay-55", name: "Backesto Park",       lat: 37.3577, lng: -121.8993, courts: 8, address: "695 E Empire St, San Jose, CA 95112" },
  { id: "bay-56", name: "Ryland Park",         lat: 37.3471, lng: -121.8993, courts: 4, address: "180 Ryland St, San Jose, CA 95110" },
  { id: "bay-57", name: "Roosevelt Park",      lat: 37.3493, lng: -121.8764, courts: 4, address: "901 E Santa Clara St, San Jose, CA 95116" },
  { id: "bay-58", name: "Kelley Park",         lat: 37.3311, lng: -121.8613, courts: 2, address: "1300 Senter Rd, San Jose, CA 95112" },
  { id: "bay-59", name: "Frank Bramhall Park", lat: 37.3102, lng: -121.8832, courts: 4, address: "1320 Minnesota Ave, San Jose, CA 95125" },
  { id: "bay-60", name: "Cahill Park",         lat: 37.3298, lng: -121.9047, courts: 2, address: "255 Stockton Ave, San Jose, CA 95126" },
  { id: "bay-61", name: "Houge Park",          lat: 37.2634, lng: -121.9371, courts: 6, address: "3972 Twilight Dr, San Jose, CA 95124" },
];
