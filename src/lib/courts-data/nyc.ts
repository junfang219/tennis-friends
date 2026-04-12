/**
 * New York City tennis courts — all five boroughs.
 *
 * Source: NYC Open Data "Athletic Facilities" dataset (qnem-b8re), joined
 * against "Parks Properties" (enfh-gkve) for park names and addresses.
 * https://data.cityofnewyork.us/resource/qnem-b8re.json?tennis=true
 * https://data.cityofnewyork.us/resource/enfh-gkve.json
 *
 * The dataset lists individual tennis courts as polygon features; this file
 * has them aggregated per park (one entry per park with the total court
 * count). Only Active facilities are included — closed and demolished
 * courts are filtered out. Coordinates are centroids of the court polygons.
 * Borough suffix is appended to the park name so different parks with the
 * same name (e.g. "Forest Park" in Queens vs elsewhere) disambiguate.
 * Lighting info is propagated when ANY court at the facility is lit.
 */

import type { BBox, CuratedCourt } from "./types";

export const NYC_BBOX: BBox = {
  south: 40.48,
  west: -74.30,
  north: 40.92,
  east: -73.68,
};

export const NYC_COURTS: CuratedCourt[] = [
  { id: "nyc-1",  name: "Central Park (Manhattan)",                           lat: 40.7899, lng: -73.9622, courts: 23, address: "5 Av To Central Park W, 59 St To 110 St" },
  { id: "nyc-2",  name: "Randall's Island Park (Manhattan)",                  lat: 40.7931, lng: -73.9189, courts: 20, address: "East River and Harlem River", lit: true },
  { id: "nyc-3",  name: "Crotona Park (Bronx)",                               lat: 40.8400, lng: -73.8947, courts: 20, address: "Crotona Park North to South, Fulton Av to Southern Blvd and Crotona Park East", lit: true },
  { id: "nyc-4",  name: "Riverside Park (Manhattan)",                         lat: 40.8044, lng: -73.9712, courts: 20, address: "Riverside Dr. to Hudson River, W. 72 St.to St Clair Pl." },
  { id: "nyc-5",  name: "Cunningham Park (Queens)",                           lat: 40.7299, lng: -73.7728, courts: 19, address: "Horace Harding Expwy, Grand Central Pkwy", lit: true },
  { id: "nyc-6",  name: "Highland Park (Brooklyn)",                           lat: 40.6839, lng: -73.8876, courts: 18, address: "Jamaica Ave. and Highland Blvd. from Highland Pl. to Bulwer Pl.", lit: true },
  { id: "nyc-7",  name: "Alley Athletic Playground (Queens)",                 lat: 40.7393, lng: -73.7365, courts: 16, address: "Winchester Blvd. bet. Union Tpke. and the Grand Central Pkwy." },
  { id: "nyc-8",  name: "Mill Pond Park (Bronx)",                             lat: 40.8235, lng: -73.9317, courts: 16, address: "Major Deegan Exwy bet. E. 150 St and E. 153 St" },
  { id: "nyc-9",  name: "Marine Park (Brooklyn)",                             lat: 40.6083, lng: -73.9354, courts: 15, address: "Flatbush, Gerritsen & Fillmore Aves, Jamaica Bay" },
  { id: "nyc-10", name: "Astoria Park (Queens)",                              lat: 40.7757, lng: -73.9244, courts: 14, address: "19 St. bet. Astoria Park S. and Ditmars Blvd." },
  { id: "nyc-11", name: "Forest Park (Queens)",                               lat: 40.6973, lng: -73.8566, courts: 14, address: "Myrtle Ave, Union Tpke, Park Lane S" },
  { id: "nyc-12", name: "Pelham Bay Park (Bronx)",                            lat: 40.8544, lng: -73.8162, courts: 13, address: "Bruckner Blvd, Eastchester, Hutchinson" },
  { id: "nyc-13", name: "Kissena Park (Queens)",                              lat: 40.7479, lng: -73.8098, courts: 12, address: "Underhill, Oak, Rose, Booth Memorial Aves, Kissena Blvd, Fresh Meadow Ln" },
  { id: "nyc-14", name: "Kaiser Park (Brooklyn)",                             lat: 40.5783, lng: -73.9944, courts: 12, address: "Neptune Ave., Bayview Ave.,W. 24 St. to W. 32 St." },
  { id: "nyc-15", name: "Van Cortlandt Park (Bronx)",                         lat: 40.8934, lng: -73.8862, courts: 12, address: "Broadway, Jerome Ave, City Line, Van Cortlandt Pk S" },
  { id: "nyc-16", name: "John V. Lindsay East River Park (Manhattan)",        lat: 40.7154, lng: -73.9755, courts: 12, address: "Montgomery St. To E. 12 St., FDR Drive" },
  { id: "nyc-17", name: "Parade Ground (Brooklyn)",                           lat: 40.6512, lng: -73.9700, courts: 11, address: "Parkside Ave., Caton Ave., bet. Parade Pl. and Coney Island Ave." },
  { id: "nyc-18", name: "Lincoln Terrace / Arthur S. Somers Park (Brooklyn)", lat: 40.6667, lng: -73.9253, courts: 11, address: "Eastern Pkwy., E. New York Ave. bet. Rochester Ave. and Portal St.", lit: true },
  { id: "nyc-19", name: "Crocheron Park (Queens)",                            lat: 40.7722, lng: -73.7688, courts: 10, address: "214 Pl., 214 La., 215 Pl, Cross Island Pkwy. bet. 33 Ave. and 35 Ave." },
  { id: "nyc-20", name: "Fort Washington Park (Manhattan)",                   lat: 40.8482, lng: -73.9463, courts: 10, address: "Riverside Dr., Hudson River, W. 155 St. to Dyckman St." },
  { id: "nyc-21", name: "Juniper Valley Park (Queens)",                       lat: 40.7204, lng: -73.8768, courts: 10, address: "Juniper Blvd. bet. Lutheran Ave., 71 St. and Dry Harbor Rd." },
  { id: "nyc-22", name: "Dyker Beach Park (Brooklyn)",                        lat: 40.6061, lng: -74.0169, courts: 9,  address: "86 St., Belt Pkwy. bet. Bay 8 St., 14 Ave., and 7 Ave." },
  { id: "nyc-23", name: "Inwood Hill Park (Manhattan)",                       lat: 40.8699, lng: -73.9219, courts: 9,  address: "Dyckman St, Hudson River, Harlem River S" },
  { id: "nyc-24", name: "John J Carty Park (Brooklyn)",                       lat: 40.6120, lng: -74.0311, courts: 8,  address: "Ft. Hamilton Pkwy. bet. 94 St. and 101 St." },
  { id: "nyc-25", name: "Detective Keith L Williams Park (Queens)",           lat: 40.7036, lng: -73.7850, courts: 8,  address: "Liberty Ave. bet. 172 St. and 173 St." },
  { id: "nyc-26", name: "Baisley Pond Park (Queens)",                         lat: 40.6752, lng: -73.7878, courts: 8,  address: "N. Conduit Ave., 116 Ave. bet. 150 St., Supthin Blvd., and Baisley Blvd. S." },
  { id: "nyc-27", name: "Linden Park (Brooklyn)",                             lat: 40.6586, lng: -73.8868, courts: 8,  address: "Vermont St. bet. Linden Blvd. and Stanley Ave." },
  { id: "nyc-28", name: "McKinley Park (Brooklyn)",                           lat: 40.6258, lng: -74.0176, courts: 8,  address: "73 St., Ft. Hamilton Pkwy., 7 Ave." },
  { id: "nyc-29", name: "Flushing Fields (Queens)",                           lat: 40.7749, lng: -73.8166, courts: 8,  address: "149 St. bet. 25 Ave. and 26 Ave., 29 Ave. and Bayside Ave." },
  { id: "nyc-30", name: "Frederick Johnson Playground (Manhattan)",           lat: 40.8248, lng: -73.9357, courts: 8,  address: "7 Ave. bet. W. 150 St. and W. 151 St." },
  { id: "nyc-31", name: "Bensonhurst Park (Brooklyn)",                        lat: 40.5952, lng: -74.0017, courts: 8,  address: "Cropsey Ave. bet. 21 Ave. and Bay Pkwy." },
  { id: "nyc-32", name: "Williamsbridge Oval (Bronx)",                        lat: 40.8780, lng: -73.8781, courts: 8,  address: "Van Cortlandt Ave. East, Resevoir Oval E" },
  { id: "nyc-33", name: "Kelly Park Playground (Brooklyn)",                   lat: 40.6047, lng: -73.9578, courts: 7,  address: "Ave. S bet. E. 14 St. and E. 15 St." },
  { id: "nyc-34", name: "McDonald Playground (Brooklyn)",                     lat: 40.6000, lng: -73.9720, courts: 7,  address: "Mcdonald Ave. between Ave. S and Ave. T" },
  { id: "nyc-35", name: "McCarren Park (Brooklyn)",                           lat: 40.7217, lng: -73.9547, courts: 7,  address: "Nassau Ave, Bayard, Leonard & N 12 Sts" },
  { id: "nyc-36", name: "Fort Greene Park (Brooklyn)",                        lat: 40.6905, lng: -73.9756, courts: 6,  address: "Myrtle Ave., De Kalb Ave. bet. Washington Park and St. Edward's St." },
  { id: "nyc-37", name: "Brookville Park (Queens)",                           lat: 40.6617, lng: -73.7444, courts: 6,  address: "S. Conduit Ave., 149 Ave. bet. 232 St. and 235 St.", lit: true },
  { id: "nyc-38", name: "Manhattan Beach Park (Brooklyn)",                    lat: 40.5776, lng: -73.9397, courts: 6,  address: "Oriental Blvd. between Ocean Ave. and Mackenzie St." },
  { id: "nyc-39", name: "Seton Park (Bronx)",                                 lat: 40.8854, lng: -73.9168, courts: 6,  address: "W 232 St, Independence Av, W 235 St" },
  { id: "nyc-40", name: "Rochdale Park (Queens)",                             lat: 40.6744, lng: -73.7739, courts: 6,  address: "Guy R. Brewer Blvd. bet. 130 Ave. and 137 Ave." },
  { id: "nyc-41", name: "Bayswater Park (Queens)",                            lat: 40.5986, lng: -73.7681, courts: 6,  address: "Dwight Ave., Seagirt Blvd. bet. Beach 38 St. and Bay 32 St." },
  { id: "nyc-42", name: "Howard Bennett Playground (Manhattan)",              lat: 40.8136, lng: -73.9384, courts: 6,  address: "W. 135 St. To W. 136 St., Lenox Ave. To 5 Ave." },
  { id: "nyc-43", name: "Walker Park (Staten Island)",                        lat: 40.6433, lng: -74.1088, courts: 6,  address: "Delafield Pl., Bard Ave., and Davis Ave." },
  { id: "nyc-44", name: "Haffen Park (Bronx)",                                lat: 40.8738, lng: -73.8403, courts: 6,  address: "Hammersley Ave. to Burke Ave. bet. Ely Ave. and Gunther Ave.", lit: true },
  { id: "nyc-45", name: "Shore Park and Parkway (Brooklyn)",                  lat: 40.6125, lng: -74.0368, courts: 4,  address: "4 Ave., Shore Rd., Belt Pkwy., Verrazano Bridge" },
  { id: "nyc-46", name: "Silver Lake Park (Staten Island)",                   lat: 40.6280, lng: -74.0994, courts: 4,  address: "Victory Blvd., Clove Rd., Forest Ave." },
  { id: "nyc-47", name: "Rockaway Community Park (Queens)",                   lat: 40.5984, lng: -73.7833, courts: 4,  address: "Conch, Sommerville & Norton Basins, Almeda Ave" },
  { id: "nyc-48", name: "Roy Wilkins Recreation Center (Queens)",             lat: 40.6858, lng: -73.7699, courts: 4,  address: "Merrick Blvd. bet. 115 Ave., 116 Ave., and Baisley Blvd." },
  { id: "nyc-49", name: "Jackie Robinson Park Playground (Brooklyn)",         lat: 40.6802, lng: -73.9281, courts: 4,  address: "Malcom X Blvd. between Chauncey St. and Marion St." },
  { id: "nyc-50", name: "St. James Park (Bronx)",                             lat: 40.8653, lng: -73.8976, courts: 4,  address: "Jerome Ave., E. 193 St., Creston Ave., E" },
  { id: "nyc-51", name: "Dutch Kills Playground (Queens)",                    lat: 40.7569, lng: -73.9335, courts: 4,  address: "28 St., Crescent St. bet. 37 Ave. and 36 Ave." },
  { id: "nyc-52", name: "Police Officer Edward Byrne Park (Queens)",          lat: 40.6671, lng: -73.8072, courts: 4,  address: "N. Conduit Ave., 135 Ave. bet. 130 Pl. and 134 St." },
  { id: "nyc-53", name: "St. Mary's Park (Bronx)",                            lat: 40.8120, lng: -73.9134, courts: 3,  address: "St Mary's St bet. St Ann's Av and Jackson Av" },
  { id: "nyc-54", name: "St. Catherine's Park (Manhattan)",                   lat: 40.7653, lng: -73.9588, courts: 3,  address: "1 Ave., bet. E. 67 St. To E. 68 St." },
  { id: "nyc-55", name: "McGuire Fields (Brooklyn)",                          lat: 40.6200, lng: -73.8987, courts: 3,  address: "Ave Y., Bergen Ave. bet. Ave. V and Belt Pkwy." },
  { id: "nyc-56", name: "Astoria Heights Playground (Queens)",                lat: 40.7603, lng: -73.9119, courts: 3,  address: "30 Rd. bet. 45 St. and 46 St." },
  { id: "nyc-57", name: "Playground One Twenty Five CXXV (Manhattan)",        lat: 40.8106, lng: -73.9552, courts: 3,  address: "Morningside Ave., W. 123 St. and W. 124 St." },
  { id: "nyc-58", name: "Sperandeo Brothers Playground (Brooklyn)",           lat: 40.6767, lng: -73.8847, courts: 3,  address: "Atlantic Ave., Cleveland St. and Liberty Ave." },
  { id: "nyc-59", name: "De Hostos Playground (Brooklyn)",                    lat: 40.7028, lng: -73.9494, courts: 3,  address: "Harrison Ave. between Walton St. and Lorimer St." },
  { id: "nyc-60", name: "Peter's Field (Manhattan)",                          lat: 40.7361, lng: -73.9816, courts: 3,  address: "E. 20 St. To E. 21 St., 1 Ave. To 2 Ave." },
  { id: "nyc-61", name: "Wolfe's Pond Park (Staten Island)",                  lat: 40.5195, lng: -74.1867, courts: 2,  address: "Holton Ave., Chisolm St., Luten Ave., Arbutus Ave. and Raritan Bay" },
  { id: "nyc-62", name: "Frank Principe Park (Queens)",                       lat: 40.7274, lng: -73.9040, courts: 2,  address: "Maurice Ave., 63 St. bet. 54 Ave. and Borden Ave." },
  { id: "nyc-63", name: "Blood Root Valley (Staten Island)",                  lat: 40.5920, lng: -74.1401, courts: 2,  address: "Rockland Ave., Manor Ave., Brielle Ave., Forest Hill Rd." },
  { id: "nyc-64", name: "Springfield Park (Queens)",                          lat: 40.6599, lng: -73.7624, courts: 2,  address: "149 Av, Springfield Bl, 145 Rd, 184 St" },
  { id: "nyc-65", name: "Van Voorhees Playground (Brooklyn)",                 lat: 40.6899, lng: -74.0000, courts: 2,  address: "Columbia St., Hicks St. bet. Congress St. and Atlantic Ave." },
  { id: "nyc-66", name: "Winthrop Playground (Brooklyn)",                     lat: 40.6564, lng: -73.9544, courts: 2,  address: "Winthrop St. between Rogers Ave. and Bedford Ave." },
  { id: "nyc-67", name: "Spirit Playground (Queens)",                         lat: 40.7611, lng: -73.9417, courts: 2,  address: "36 Ave bet. 9 St. and 10 St." },
  { id: "nyc-68", name: "Cooper Park (Brooklyn)",                             lat: 40.7160, lng: -73.9365, courts: 2,  address: "Maspeth Ave., Sharon St. bet. Olive St. and Morgan Ave." },
  { id: "nyc-69", name: "South Oxford Park (Brooklyn)",                       lat: 40.6837, lng: -73.9723, courts: 2,  address: "S. Oxford St. bet. Commos and Atlantic Ave." },
  { id: "nyc-70", name: "Broad Channel Park (Queens)",                        lat: 40.6009, lng: -73.8197, courts: 2,  address: "Cross Bay Blvd., Channel Rd. bet. E. 16 Rd. and E. 18 Rd." },
  { id: "nyc-71", name: "Archie Spigner Park (Queens)",                       lat: 40.6939, lng: -73.7801, courts: 2,  address: "169 St., Merrick Blvd., Marne Pl. bet. Linden Blvd., Sayres Ave., and 111 Rd." },
  { id: "nyc-72", name: "Midland Field (Staten Island)",                      lat: 40.5764, lng: -74.0996, courts: 2,  address: "Midland Ave., Mason Ave., Bedford Ave., Boundary Ave." },
  { id: "nyc-73", name: "Russell Sage Playground (Queens)",                   lat: 40.7238, lng: -73.8515, courts: 2,  address: "Booth St. bet. 68 Ave. and 68 Dr." },
  { id: "nyc-74", name: "Oakland Gardens (Queens)",                           lat: 40.7539, lng: -73.7600, courts: 2,  address: "Springfield Blvd. bet. 53 Ave. and 56 Ave." },
  { id: "nyc-75", name: "Stars & Stripes Playground (Bronx)",                 lat: 40.8855, lng: -73.8400, courts: 2,  address: "Crawford Ave. at Baychester Ave." },
  { id: "nyc-76", name: "Friends Field (Brooklyn)",                           lat: 40.6183, lng: -73.9723, courts: 2,  address: "Ave. L, E. 4 St., Mcdonald Ave., Ave. M" },
  { id: "nyc-77", name: "Louis Pasteur Park (Queens)",                        lat: 40.7618, lng: -73.7351, courts: 2,  address: "248 St. bet. Van Zandt Ave. and 52 Ave." },
  { id: "nyc-78", name: "Clintonville Playground (Queens)",                   lat: 40.7835, lng: -73.8080, courts: 2,  address: "Clintonville St. bet. 17 Ave. and 17 Rd." },
  { id: "nyc-79", name: "Fairview Park (Staten Island)",                      lat: 40.5314, lng: -74.2318, courts: 2,  address: "Englewood Ave., W. Shore Expwy., Veterans Rd. W." },
  { id: "nyc-80", name: "Rory Staunton Field (Queens)",                       lat: 40.7539, lng: -73.8883, courts: 2,  address: "78 St., 79 St. bet. Northern Blvd. and 34 Ave." },
  { id: "nyc-81", name: "Kissena Corridor Park (Queens)",                     lat: 40.7447, lng: -73.7873, courts: 1,  address: "Peck & Underhill Aves, Utopia Pkwy, Horace Harding" },
  { id: "nyc-82", name: "Helen Marshall Playground (Queens)",                 lat: 40.7652, lng: -73.8707, courts: 1,  address: "100 St., 98 St. bet. 24 Ave. and 25 Ave." },
  { id: "nyc-83", name: "Paul Raimonda Playground (Queens)",                  lat: 40.7730, lng: -73.8977, courts: 1,  address: "20 Ave. bet. 47 St. and 48 St." },
  { id: "nyc-84", name: "Colden Playground (Queens)",                         lat: 40.7705, lng: -73.8277, courts: 1,  address: "Union St. bet. 31 Rd. and 31 Dr." },
  { id: "nyc-85", name: "Ericsson Playground (Brooklyn)",                     lat: 40.7206, lng: -73.9483, courts: 1,  address: "Manhattan Ave. and Leonard St." },
  { id: "nyc-86", name: "Fountain Of Youth Playground (Bronx)",               lat: 40.8144, lng: -73.9050, courts: 1,  address: "Union Av bet. E 150 St and E 152 St" },
  { id: "nyc-87", name: "Wald Playground (Manhattan)",                        lat: 40.7198, lng: -73.9769, courts: 1,  address: "E. Houston St. and FDR Dr." },
  { id: "nyc-88", name: "Moore Playground (Manhattan)",                       lat: 40.8094, lng: -73.9387, courts: 1,  address: "Madison Ave. bet. E. 130 St. and E. 131 St." },
  { id: "nyc-89", name: "Robert E. Venable Park (Brooklyn)",                  lat: 40.6748, lng: -73.8656, courts: 1,  address: "Belmont Ave., Sutter Ave., Sheridan Ave. and Grant Ave." },
  { id: "nyc-90", name: "Marcy Playground (Brooklyn)",                        lat: 40.6952, lng: -73.9520, courts: 1,  address: "Myrtle Ave. bet. Nostrand Ave. and Marcy Ave." },
  { id: "nyc-91", name: "Washington Market Park (Manhattan)",                 lat: 40.7171, lng: -74.0121, courts: 1,  address: "Chambers St. bet. Greenwich St. and West St." },
  { id: "nyc-92", name: "Decatur Playground (Brooklyn)",                      lat: 40.6815, lng: -73.9364, courts: 1,  address: "Decatur St., Macdonough St. bet. Lewis Ave. and Marcus Garvey Blvd." },
  { id: "nyc-93", name: "Tilden Playground (Brooklyn)",                       lat: 40.6473, lng: -73.9312, courts: 1,  address: "Tilden Ave. between E. 48 St. and E. 49 St." },
  { id: "nyc-94", name: "Riverside Park South (Manhattan)",                   lat: 40.7810, lng: -73.9882, courts: 1,  address: "12 Ave., Riverside Blvd. bet. W. 59 St. and W. 72 St." },
  { id: "nyc-95", name: "John Jay Park (Manhattan)",                          lat: 40.7691, lng: -73.9497, courts: 1,  address: "FDR Dr., E 76 St. To E 78 St." },
];
