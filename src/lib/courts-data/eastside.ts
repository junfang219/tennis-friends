/**
 * Seattle Eastside tennis courts — Bellevue, Redmond, Kirkland, Issaquah,
 * Sammamish, Mercer Island.
 *
 * Primary sources:
 *   - Bellevue Parks: bellevuewa.gov/.../outdoor-tennis-courts (verified, 18 facilities)
 *   - Issaquah Parks: issaquahwa.gov/3287/Pickleball-Tennis-Courts (verified, 4 facilities)
 *   - Sammamish Parks: sammamish.us park pages (East Sammamish, NE Sammamish verified)
 *   - Mercer Island Parks: mercerisland.gov/parksrec (Aubrey Davis Park address verified)
 *
 * Redmond and Kirkland parks-department directories returned 403/404 via
 * automated fetch; those entries are sourced from general parks knowledge
 * (Hartman, Perrigo, Grass Lawn, Peter Kirk, Everest, Crestwoods) and
 * cross-referenced against OSM for coordinates. Court counts for those
 * facilities are approximate and should be verified before shipping to
 * production.
 */

import type { BBox, CuratedCourt } from "./types";

export const EASTSIDE_BBOX: BBox = {
  south: 47.50,   // extended south to cover Central Park Issaquah + Meerwood Park (~47.52)
  west: -122.25,
  north: 47.75,
  east: -121.96,  // extended east to cover Black Nugget Park (~-121.9994)
};

export const EASTSIDE_COURTS: CuratedCourt[] = [
  // ===== Bellevue (from bellevuewa.gov outdoor tennis courts page) =====
  { id: "east-1",  name: "Robinswood Tennis Center",  lat: 47.5986, lng: -122.1412, courts: 8, address: "2400 151st Pl SE, Bellevue, WA 98007", lit: true },
  { id: "east-2",  name: "Crossroads Community Park", lat: 47.6220, lng: -122.1300, courts: 3, address: "16000 NE 10th St, Bellevue, WA 98008" },
  { id: "east-3",  name: "Cherry Crest Park",         lat: 47.6391, lng: -122.1691, courts: 3, address: "12404 NE 32nd St, Bellevue, WA 98005" },
  { id: "east-4",  name: "Cherry Crest Mini Park",    lat: 47.6365, lng: -122.1645, courts: 1, address: "2532 127th Ave NE, Bellevue, WA 98005" },
  { id: "east-5",  name: "Eastgate Park",             lat: 47.5772, lng: -122.1375, courts: 2, address: "14500 SE Newport Way, Bellevue, WA 98006" },
  { id: "east-6",  name: "Enatai Neighborhood Park",  lat: 47.5811, lng: -122.1964, courts: 2, address: "10661 SE 25th St, Bellevue, WA 98004" },
  { id: "east-7",  name: "Hidden Valley Sports Park", lat: 47.6250, lng: -122.1956, courts: 1, address: "1901 112th Ave NE, Bellevue, WA 98004", lit: true },
  { id: "east-8",  name: "Highland Community Park",   lat: 47.6302, lng: -122.1478, courts: 2, address: "14224 NE Bel-Red Rd, Bellevue, WA 98007" },
  { id: "east-9",  name: "Hillaire Park",             lat: 47.6167, lng: -122.1405, courts: 2, address: "15731 NE 6th St, Bellevue, WA 98008" },
  { id: "east-10", name: "Killarney Glen Park",       lat: 47.5906, lng: -122.2014, courts: 2, address: "1933 104th Ave SE, Bellevue, WA 98004" },
  { id: "east-11", name: "Lakemont Highlands Park",   lat: 47.5572, lng: -122.1156, courts: 1, address: "15800 SE 63rd St, Bellevue, WA 98006" },
  { id: "east-12", name: "Lakemont Community Park",   lat: 47.5633, lng: -122.1056, courts: 2, address: "5170 Village Park Dr SE, Bellevue, WA 98006" },
  { id: "east-13", name: "Norwood Village Park",      lat: 47.5847, lng: -122.1608, courts: 2, address: "12309 SE 23rd Pl, Bellevue, WA 98005" },
  { id: "east-14", name: "Silverleaf Park",           lat: 47.5586, lng: -122.1219, courts: 2, address: "4900 block of 164th Ave SE, Bellevue, WA 98006" },
  { id: "east-15", name: "Spiritridge Park",          lat: 47.5808, lng: -122.1271, courts: 1, address: "16100 SE 33rd Pl, Bellevue, WA 98008" },
  { id: "east-16", name: "Sunset Park (Bellevue)",    lat: 47.5886, lng: -122.1431, courts: 1, address: "2837 139th Ave SE, Bellevue, WA 98005" },
  { id: "east-17", name: "Westwood Highlands Park",   lat: 47.5772, lng: -122.1508, courts: 1, address: "5501 136th Pl SE, Bellevue, WA 98006" },
  { id: "east-18", name: "Zumdieck Park",             lat: 47.6241, lng: -122.1931, courts: 2, address: "1500 108th Ave NE, Bellevue, WA 98004" },

  // ===== Issaquah (from issaquahwa.gov pickleball/tennis page) =====
  { id: "east-19", name: "Black Nugget Park",         lat: 47.5511, lng: -121.9994, courts: 2, address: "25335 NE Black Nugget Rd, Issaquah, WA 98029" },
  { id: "east-20", name: "Central Park (Issaquah)",   lat: 47.5283, lng: -122.0300, courts: 2, address: "700 Central Park Way NE, Issaquah, WA 98029" },
  { id: "east-21", name: "Tibbetts Valley Park",      lat: 47.5394, lng: -122.0612, courts: 1, address: "965 12th Ave NW, Issaquah, WA 98027" },
  { id: "east-22", name: "Meerwood Park",             lat: 47.5233, lng: -122.0250, courts: 1, address: "3200 E Lake Sammamish Pkwy SE, Issaquah, WA 98029" },

  // ===== Sammamish (park amenity pages verified) =====
  { id: "east-23", name: "East Sammamish Park",       lat: 47.6175, lng: -122.0339, courts: 1, address: "21300 NE 16th St, Sammamish, WA 98074" },
  { id: "east-24", name: "Northeast Sammamish Park",  lat: 47.6450, lng: -122.0175, courts: 1, address: "21210 NE 36th St, Sammamish, WA 98074" },

  // ===== Mercer Island =====
  { id: "east-25", name: "Aubrey Davis Park",         lat: 47.5700, lng: -122.2269, courts: 4, address: "72nd Ave SE & SE 22nd St, Mercer Island, WA 98040" },

  // ===== Kirkland (parks-dept directory inaccessible; entries from general knowledge) =====
  { id: "east-26", name: "Peter Kirk Park",           lat: 47.6811, lng: -122.2083, courts: 2, address: "202 3rd St, Kirkland, WA 98033" },
  { id: "east-27", name: "Everest Park",              lat: 47.6739, lng: -122.2033, courts: 2, address: "730 8th St S, Kirkland, WA 98033" },
  { id: "east-28", name: "Crestwoods Park",           lat: 47.6597, lng: -122.1969, courts: 2, address: "10101 NE 63rd St, Kirkland, WA 98033" },
  { id: "east-29", name: "North Kirkland Community Center", lat: 47.7053, lng: -122.1961, courts: 2, address: "12421 103rd Ave NE, Kirkland, WA 98034" },

  // ===== Redmond (parks-dept directory inaccessible; entries from general knowledge) =====
  { id: "east-30", name: "Hartman Park",              lat: 47.7097, lng: -122.1214, courts: 4, address: "17217 NE 104th St, Redmond, WA 98052", lit: true },
  { id: "east-31", name: "Perrigo Park",              lat: 47.6944, lng: -122.0947, courts: 4, address: "9011 196th Ave NE, Redmond, WA 98053" },
  { id: "east-32", name: "Grass Lawn Park",           lat: 47.6692, lng: -122.1422, courts: 2, address: "7031 148th Ave NE, Redmond, WA 98052" },
];
