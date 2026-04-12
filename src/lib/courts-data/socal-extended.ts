/**
 * Southern California extended tennis courts — covers cities NOT curated
 * by `los-angeles.ts` (which currently lists only LA City, Santa Monica,
 * Beverly Hills, Culver City, Pasadena, Long Beach).
 *
 * Cities covered:
 *
 *   Orange County: Irvine, Santa Ana, Costa Mesa, Newport Beach, Huntington
 *   Beach, Anaheim, Orange, Fullerton, Tustin, Fountain Valley, Garden Grove,
 *   Westminster, Buena Park, La Habra, Brea, Yorba Linda, Cypress, Stanton,
 *   Los Alamitos, Lake Forest, Laguna Beach, Laguna Hills, Laguna Niguel,
 *   Mission Viejo, Rancho Santa Margarita, Dana Point, San Clemente.
 *
 *   Inland Empire: Riverside, San Bernardino, Corona, Fontana, Rancho
 *   Cucamonga, Ontario, Upland, Pomona, Chino, Chino Hills, Redlands,
 *   Moreno Valley.
 *
 *   Ventura County: Ventura, Oxnard, Camarillo, Thousand Oaks, Simi Valley,
 *   Moorpark, Agoura Hills, Calabasas.
 *
 *   San Gabriel Valley / SE LA: Burbank, Glendale, Alhambra, Monterey Park,
 *   Arcadia, Monrovia, Duarte, San Marino, Whittier, Downey, Norwalk,
 *   Cerritos, Lakewood, Bellflower, Compton, Rowland Heights, Diamond Bar,
 *   West Covina, Covina, Azusa, Glendora.
 *
 * Data derivation (same approach as wa-puget-sound.ts / portland.ts /
 * chicago.ts):
 *   1. Queried OpenStreetMap via Overpass for leisure=pitch + sport=tennis
 *      across 4 sub-bboxes (Orange County, Inland Empire, Ventura County,
 *      San Gabriel Valley / SE LA).
 *   2. Separately queried named leisure=park ways with bounding boxes.
 *   3. Spatial-joined each pitch to the smallest containing named park.
 *   4. Classified parks by city via lat/lng bounding boxes.
 *   5. Excluded cities already covered by `los-angeles.ts` (Santa Monica,
 *      Beverly Hills, Culver City, Pasadena, Long Beach) to avoid dupes.
 *
 * Addresses are empty because OSM doesn't have park addresses. Court counts
 * may occasionally overcount when OSM tags individual court halves as
 * separate pitches.
 */

import type { BBox, CuratedCourt } from "./types";

export const SOCAL_EXTENDED_BBOX: BBox = {
  south: 33.40,
  west: -119.40,
  north: 34.55,
  east: -117.00,
};

export const SOCAL_EXTENDED_COURTS: CuratedCourt[] = [
// ----- Agoura Hills -----
  { id: "soc-210", name: "Mae Boyar Park (Agoura Hills)"                                 , lat: 34.1717, lng: -118.7573, courts: 1, address: "" },

  // ----- Alhambra -----
  { id: "soc-269", name: "Alhambra Park (Alhambra)"                                      , lat: 34.0951, lng: -118.1454, courts: 5, address: "" },
  { id: "soc-230", name: "Almansor Park (Alhambra)"                                      , lat: 34.0873, lng: -118.1166, courts: 4, address: "" },
  { id: "soc-246", name: "Smith Park (Alhambra)"                                         , lat: 34.0986, lng: -118.1029, courts: 3, address: "" },
  { id: "soc-229", name: "Granada Park (Alhambra)"                                       , lat: 34.0668, lng: -118.1464, courts: 2, address: "" },
  { id: "soc-270", name: "Joslyn Adult Recreation Center (Alhambra)"                     , lat: 34.0991, lng: -118.1248, courts: 2, address: "" },

  // ----- Anaheim -----
  { id: "soc-8", name: "Pearson Park (Anaheim)"                                        , lat: 33.8372, lng: -117.9182, courts: 6, address: "", lit: true },
  { id: "soc-135", name: "Boisseranc Park (Anaheim)"                                     , lat: 33.8538, lng: -117.984, courts: 4, address: "" },
  { id: "soc-65", name: "Woodgate Park (Anaheim)"                                       , lat: 33.8651, lng: -117.784, courts: 1, address: "" },

  // ----- Arcadia -----
  { id: "soc-272", name: "Arcadia County Park (Arcadia)"                                 , lat: 34.1371, lng: -118.0344, courts: 12, address: "" },
  { id: "soc-271", name: "Live Oak Park (Arcadia)"                                       , lat: 34.103, lng: -118.0468, courts: 7, address: "" },
  { id: "soc-278", name: "Orange Grove Park (Arcadia)"                                   , lat: 34.1566, lng: -118.0524, courts: 5, address: "" },
  { id: "soc-265", name: "Recreation Park (Arcadia)"                                     , lat: 34.1453, lng: -117.9888, courts: 4, address: "", lit: true },
  { id: "soc-262", name: "Camino Grove Park (Arcadia)"                                   , lat: 34.1235, lng: -118.0183, courts: 3, address: "" },
  { id: "soc-232", name: "Sierra Vista Park (Arcadia)"                                   , lat: 34.1633, lng: -118.0409, courts: 2, address: "" },
  { id: "soc-251", name: "Bicentennial Park (Arcadia)"                                   , lat: 34.1139, lng: -118.0188, courts: 2, address: "" },
  { id: "soc-260", name: "Sierra Madre Memorial Park (Arcadia)"                          , lat: 34.1611, lng: -118.0577, courts: 2, address: "" },
  { id: "soc-261", name: "Tierra Verde Park (Arcadia)"                                   , lat: 34.1213, lng: -118.0241, courts: 2, address: "" },
  { id: "soc-273", name: "Newcastle Park (Arcadia)"                                      , lat: 34.1458, lng: -118.0346, courts: 2, address: "" },

  // ----- Azusa -----
  { id: "soc-236", name: "Memorial Park (Azusa)"                                         , lat: 34.1277, lng: -117.9107, courts: 3, address: "" },
  { id: "soc-237", name: "Northside Park (Azusa)"                                        , lat: 34.1432, lng: -117.9129, courts: 1, address: "" },

  // ----- Buena Park -----
  { id: "soc-52", name: "Bellis Park (Buena Park)"                                      , lat: 33.8687, lng: -118.01, courts: 5, address: "" },

  // ----- Burbank -----
  { id: "soc-275", name: "McCambridge Park (Burbank)"                                    , lat: 34.1922, lng: -118.3208, courts: 12, address: "", lit: true },
  { id: "soc-280", name: "Mountain View Park (Burbank)"                                  , lat: 34.158, lng: -118.3153, courts: 2, address: "" },
  { id: "soc-281", name: "George Izay Park (Burbank)"                                    , lat: 34.1724, lng: -118.3186, courts: 2, address: "" },
  { id: "soc-286", name: "Verdugo Park (Burbank)"                                        , lat: 34.1637, lng: -118.3397, courts: 2, address: "" },

  // ----- Calabasas -----
  { id: "soc-191", name: "Gates Canyon Park (Calabasas)"                                 , lat: 34.1614, lng: -118.6926, courts: 2, address: "" },

  // ----- Camarillo -----
  { id: "soc-202", name: "Valle Lindo Park (Camarillo)"                                  , lat: 34.2256, lng: -119.0572, courts: 10, address: "" },
  { id: "soc-200", name: "Mission Oaks Community Park (Camarillo)"                       , lat: 34.2315, lng: -118.9915, courts: 6, address: "" },
  { id: "soc-220", name: "Bob Kildee Community Park (Camarillo)"                         , lat: 34.229, lng: -119.0284, courts: 4, address: "" },
  { id: "soc-223", name: "Borchard Community Park (Camarillo)"                           , lat: 34.1814, lng: -118.9524, courts: 4, address: "", lit: true },
  { id: "soc-203", name: "Springville Dog Park (Camarillo)"                              , lat: 34.2255, lng: -119.0868, courts: 3, address: "" },
  { id: "soc-189", name: "Pitts Ranch Park (Camarillo)"                                  , lat: 34.2307, lng: -119.0111, courts: 1, address: "" },
  { id: "soc-190", name: "Casas De La Senda Park (Private) (Camarillo)"                  , lat: 34.1823, lng: -118.9572, courts: 1, address: "" },

  // ----- Cerritos -----
  { id: "soc-33", name: "Cerritos Park East (Cerritos)"                                 , lat: 33.8784, lng: -118.0515, courts: 4, address: "" },

  // ----- Chino -----
  { id: "soc-149", name: "Crossroads Park (Chino)"                                       , lat: 33.9811, lng: -117.7426, courts: 2, address: "" },

  // ----- Compton -----
  { id: "soc-228", name: "East Rancho Dominguez County Park (Compton)"                   , lat: 33.8958, lng: -118.1926, courts: 2, address: "" },

  // ----- Corona -----
  { id: "soc-57", name: "Kellogg Park (Corona)"                                         , lat: 33.8639, lng: -117.5576, courts: 4, address: "" },
  { id: "soc-137", name: "Mountain Gate Park (Corona)"                                   , lat: 33.8407, lng: -117.5732, courts: 4, address: "" },
  { id: "soc-10", name: "Promenade Community Park (Corona)"                             , lat: 33.8958, lng: -117.5196, courts: 2, address: "" },
  { id: "soc-61", name: "El Cerrito Sports Park (Corona)"                               , lat: 33.8348, lng: -117.528, courts: 2, address: "" },
  { id: "soc-70", name: "Mangular Park (Corona)"                                        , lat: 33.859, lng: -117.5978, courts: 2, address: "", lit: true },
  { id: "soc-15", name: "Kips Korner Park (Corona)"                                     , lat: 33.9118, lng: -117.5808, courts: 1, address: "" },
  { id: "soc-63", name: "Husted Park (Corona)"                                          , lat: 33.87, lng: -117.5732, courts: 1, address: "" },

  // ----- Costa Mesa -----
  { id: "soc-113", name: "TeWinkle Park (Costa Mesa)"                                    , lat: 33.6702, lng: -117.8931, courts: 12, address: "" },
  { id: "soc-47", name: "Wimbledon Park (Costa Mesa)"                                   , lat: 33.6934, lng: -117.9058, courts: 3, address: "", lit: true },
  { id: "soc-50", name: "Ellis Park (Costa Mesa)"                                       , lat: 33.6951, lng: -117.9494, courts: 2, address: "" },
  { id: "soc-96", name: "LeBard Park (Costa Mesa)"                                      , lat: 33.6651, lng: -117.9495, courts: 2, address: "" },

  // ----- Covina -----
  { id: "soc-263", name: "Dawson Avenue Park (Covina)"                                   , lat: 34.1181, lng: -117.8672, courts: 6, address: "", lit: true },
  { id: "soc-243", name: "Kahler Russell Park (Covina)"                                  , lat: 34.0935, lng: -117.8656, courts: 1, address: "" },

  // ----- Cypress -----
  { id: "soc-136", name: "Central Park (Cypress)"                                        , lat: 33.8487, lng: -118.0391, courts: 2, address: "" },

  // ----- Dana Point -----
  { id: "soc-80", name: "Del Obispo Park Community Center (Dana Point)"                 , lat: 33.469, lng: -117.6834, courts: 3, address: "" },

  // ----- Diamond Bar -----
  { id: "soc-244", name: "Maple Hill Park (Diamond Bar)"                                 , lat: 33.9961, lng: -117.8267, courts: 1, address: "" },
  { id: "soc-245", name: "Sycamore Canyon Park (Diamond Bar)"                            , lat: 34.0072, lng: -117.8159, courts: 1, address: "" },

  // ----- Downey -----
  { id: "soc-242", name: "Furman Park (Downey)"                                          , lat: 33.9526, lng: -118.138, courts: 3, address: "" },
  { id: "soc-248", name: "Bell Gardens Veterans Park (Downey)"                           , lat: 33.9667, lng: -118.1469, courts: 2, address: "" },

  // ----- Duarte -----
  { id: "soc-252", name: "Encanto Park (Duarte)"                                         , lat: 34.1446, lng: -117.937, courts: 2, address: "" },

  // ----- Fontana -----
  { id: "soc-150", name: "Koehler Park (Fontana)"                                        , lat: 34.1297, lng: -117.4697, courts: 2, address: "" },
  { id: "soc-161", name: "Rialto City Park (Fontana)"                                    , lat: 34.0791, lng: -117.3694, courts: 2, address: "", lit: true },
  { id: "soc-172", name: "Catawba Park (Fontana)"                                        , lat: 34.0457, lng: -117.4584, courts: 2, address: "" },
  { id: "soc-176", name: "Southridge Park (Fontana)"                                     , lat: 34.04, lng: -117.4851, courts: 2, address: "" },
  { id: "soc-182", name: "Kaiser Park (Fontana)"                                         , lat: 34.0805, lng: -117.4904, courts: 2, address: "" },

  // ----- Fullerton -----
  { id: "soc-109", name: "Portola Park (Fullerton)"                                      , lat: 33.9288, lng: -117.9478, courts: 8, address: "" },
  { id: "soc-131", name: "Tracks at Brea (Fullerton)"                                    , lat: 33.9184, lng: -117.8784, courts: 4, address: "" },
  { id: "soc-5", name: "Craig Regional Park (Fullerton)"                               , lat: 33.8998, lng: -117.8839, courts: 2, address: "" },
  { id: "soc-12", name: "Hillcrest Park (Fullerton)"                                    , lat: 33.8852, lng: -117.92, courts: 1, address: "" },

  // ----- Garden Grove -----
  { id: "soc-43", name: "Stanton Central Park (Garden Grove)"                           , lat: 33.8069, lng: -118.0006, courts: 4, address: "" },
  { id: "soc-133", name: "Magnolia Park (Garden Grove)"                                  , lat: 33.7974, lng: -117.9746, courts: 2, address: "" },

  // ----- Glendale -----
  { id: "soc-235", name: "Fremont Park (Glendale)"                                       , lat: 34.1574, lng: -118.2682, courts: 8, address: "" },
  { id: "soc-233", name: "Montrose Community Park (Glendale)"                            , lat: 34.2019, lng: -118.2246, courts: 2, address: "", lit: true },
  { id: "soc-253", name: "Emerald Isle Park (Glendale)"                                  , lat: 34.1805, lng: -118.201, courts: 2, address: "" },
  { id: "soc-259", name: "Oakmont View Park (Glendale)"                                  , lat: 34.2004, lng: -118.2432, courts: 2, address: "" },
  { id: "soc-268", name: "Yosemite Recreation Center (Glendale)"                         , lat: 34.1331, lng: -118.2072, courts: 2, address: "" },
  { id: "soc-279", name: "Nibley Park (Glendale)"                                        , lat: 34.1645, lng: -118.2383, courts: 2, address: "" },
  { id: "soc-240", name: "Dunsmore Park (Glendale)"                                      , lat: 34.2388, lng: -118.2567, courts: 1, address: "" },
  { id: "soc-241", name: "Glenoaks Park (Glendale)"                                      , lat: 34.1525, lng: -118.2097, courts: 1, address: "" },
  { id: "soc-255", name: "Glenhaven Park (Glendale)"                                     , lat: 34.2094, lng: -118.2196, courts: 1, address: "" },
  { id: "soc-257", name: "Glorietta Park (Glendale)"                                     , lat: 34.1879, lng: -118.2275, courts: 1, address: "" },

  // ----- Glendora -----
  { id: "soc-277", name: "George Manooshian Park (Glendora)"                             , lat: 34.1501, lng: -117.847, courts: 6, address: "" },
  { id: "soc-249", name: "Sandburg Middle School Park (Glendora)"                        , lat: 34.1421, lng: -117.8774, courts: 4, address: "" },
  { id: "soc-238", name: "Lone Hill Park (Glendora)"                                     , lat: 34.1119, lng: -117.835, courts: 2, address: "" },
  { id: "soc-239", name: "Finkbiner Park (Glendora)"                                     , lat: 34.1382, lng: -117.8611, courts: 2, address: "" },
  { id: "soc-276", name: "Pioneer Park (Glendora)"                                       , lat: 34.1049, lng: -117.8134, courts: 2, address: "" },

  // ----- Huntington Beach -----
  { id: "soc-88", name: "Fountain Valley Sports Park (Huntington Beach)"                , lat: 33.7272, lng: -117.9532, courts: 14, address: "" },
  { id: "soc-4", name: "Murdy Park (Huntington Beach)"                                 , lat: 33.718, lng: -118.0039, courts: 4, address: "" },
  { id: "soc-9", name: "Edison Community Park (Huntington Beach)"                      , lat: 33.6524, lng: -117.9731, courts: 4, address: "", lit: true },
  { id: "soc-103", name: "Pattinson Park (Huntington Beach)"                             , lat: 33.6759, lng: -118.0213, courts: 4, address: "" },
  { id: "soc-101", name: "Lambert Park (Huntington Beach)"                               , lat: 33.6965, lng: -117.9805, courts: 1, address: "" },

  // ----- Irvine -----
  { id: "soc-99", name: "Great Park Sports Complex (Irvine)"                            , lat: 33.6761, lng: -117.7365, courts: 25, address: "", lit: true },
  { id: "soc-82", name: "North Lake Park (Irvine)"                                      , lat: 33.6805, lng: -117.7946, courts: 10, address: "" },
  { id: "soc-72", name: "South Lake Park (Irvine)"                                      , lat: 33.67, lng: -117.8034, courts: 9, address: "", lit: true },
  { id: "soc-93", name: "David Sills Lower Peters Canyon Park (Irvine)"                 , lat: 33.7155, lng: -117.7792, courts: 8, address: "" },
  { id: "soc-11", name: "Bill Barber Memorial Park (Irvine)"                            , lat: 33.6888, lng: -117.8209, courts: 6, address: "", lit: true },
  { id: "soc-59", name: "Tustin Sports Park (Irvine)"                                   , lat: 33.735, lng: -117.7849, courts: 6, address: "", lit: true },
  { id: "soc-139", name: "Orangetree Park (Irvine)"                                      , lat: 33.6718, lng: -117.7724, courts: 5, address: "" },
  { id: "soc-21", name: "Lake Forest Sun and Sail Club (Irvine)"                        , lat: 33.6418, lng: -117.7009, courts: 4, address: "" },
  { id: "soc-22", name: "Woodbury Rec Center (Irvine)"                                  , lat: 33.6978, lng: -117.7503, courts: 4, address: "" },
  { id: "soc-87", name: "Deerfield Community Park (Irvine)"                             , lat: 33.6923, lng: -117.7914, courts: 4, address: "" },
  { id: "soc-104", name: "University Community Park (Irvine)"                            , lat: 33.6614, lng: -117.8192, courts: 4, address: "" },
  { id: "soc-105", name: "Columbus Tustin Park (Irvine)"                                 , lat: 33.75, lng: -117.8208, courts: 4, address: "" },
  { id: "soc-108", name: "Citrusglen Park (Irvine)"                                      , lat: 33.7218, lng: -117.7497, courts: 4, address: "" },
  { id: "soc-122", name: "Turtle Rock Community Park (Irvine)"                           , lat: 33.6328, lng: -117.804, courts: 4, address: "" },
  { id: "soc-25", name: "Cypress Community Park (Irvine)"                               , lat: 33.6917, lng: -117.7631, courts: 3, address: "" },
  { id: "soc-36", name: "Magnolia Tree Park (Irvine)"                                   , lat: 33.7195, lng: -117.8133, courts: 3, address: "", lit: true },
  { id: "soc-51", name: "Homestead Park (Irvine)"                                       , lat: 33.7302, lng: -117.7803, courts: 3, address: "" },
  { id: "soc-83", name: "Los Olivos Community Park (Irvine)"                            , lat: 33.6364, lng: -117.7467, courts: 3, address: "", lit: true },
  { id: "soc-91", name: "Forest Glen Park (Irvine)"                                     , lat: 33.7298, lng: -117.769, courts: 3, address: "" },
  { id: "soc-114", name: "Turtle Rock Glen Park (Irvine)"                                , lat: 33.6472, lng: -117.8117, courts: 3, address: "" },
  { id: "soc-2", name: "Park Paseo Recreation Center (Irvine)"                         , lat: 33.7176, lng: -117.7599, courts: 2, address: "" },
  { id: "soc-17", name: "Stonegate Park (Irvine)"                                       , lat: 33.7063, lng: -117.7408, courts: 2, address: "", lit: true },
  { id: "soc-20", name: "Mountain View Park (Irvine)"                                   , lat: 33.6287, lng: -117.7113, courts: 2, address: "", lit: true },
  { id: "soc-24", name: "Woodbridge Community Park (Irvine)"                            , lat: 33.6768, lng: -117.8044, courts: 2, address: "" },
  { id: "soc-26", name: "Egret Park (Irvine)"                                           , lat: 33.7072, lng: -117.7461, courts: 2, address: "" },
  { id: "soc-27", name: "Silverado Park (Irvine)"                                       , lat: 33.6952, lng: -117.7173, courts: 2, address: "" },
  { id: "soc-28", name: "Racquet Club Park (Irvine)"                                    , lat: 33.7134, lng: -117.7784, courts: 2, address: "" },
  { id: "soc-30", name: "San Marino Park (Irvine)"                                      , lat: 33.6801, lng: -117.8202, courts: 2, address: "" },
  { id: "soc-31", name: "Stone Creek Swim Club (Irvine)"                                , lat: 33.6905, lng: -117.7989, courts: 2, address: "" },
  { id: "soc-32", name: "Royal Oak Park (Irvine)"                                       , lat: 33.6665, lng: -117.7873, courts: 2, address: "" },
  { id: "soc-46", name: "Las Lomas Community Park (Irvine)"                             , lat: 33.6297, lng: -117.8286, courts: 2, address: "", lit: true },
  { id: "soc-54", name: "Eastwood Neighborhood Park (Irvine)"                           , lat: 33.7166, lng: -117.7499, courts: 2, address: "" },
  { id: "soc-55", name: "Greenfield Park (Irvine)"                                      , lat: 33.689, lng: -117.7121, courts: 2, address: "" },
  { id: "soc-64", name: "Hoeptner Park (Irvine)"                                        , lat: 33.6859, lng: -117.7759, courts: 2, address: "" },
  { id: "soc-67", name: "Timber Run Park (Irvine)"                                      , lat: 33.6734, lng: -117.817, courts: 2, address: "" },
  { id: "soc-68", name: "Knollcrest Park (Irvine)"                                      , lat: 33.6488, lng: -117.7737, courts: 2, address: "" },
  { id: "soc-69", name: "Cornell Commons (Irvine)"                                      , lat: 33.6501, lng: -117.8335, courts: 2, address: "", lit: true },
  { id: "soc-86", name: "Princeton Park (Irvine)"                                       , lat: 33.6558, lng: -117.8424, courts: 2, address: "" },
  { id: "soc-100", name: "San Carlo Park (Irvine)"                                       , lat: 33.6806, lng: -117.829, courts: 2, address: "" },
  { id: "soc-106", name: "Resort at the Groves (Irvine)"                                 , lat: 33.7466, lng: -117.7598, courts: 2, address: "" },
  { id: "soc-116", name: "Clearbrook Park (Irvine)"                                      , lat: 33.6655, lng: -117.8211, courts: 2, address: "" },
  { id: "soc-121", name: "Valley Oak Park (Irvine)"                                      , lat: 33.6665, lng: -117.7751, courts: 2, address: "" },
  { id: "soc-123", name: "Woodside Park (Irvine)"                                        , lat: 33.7201, lng: -117.7663, courts: 2, address: "" },
  { id: "soc-140", name: "Northwood Community Park (Irvine)"                             , lat: 33.7109, lng: -117.7674, courts: 2, address: "" },
  { id: "soc-7", name: "Crestwood Park (Irvine)"                                       , lat: 33.7224, lng: -117.7695, courts: 1, address: "" },
  { id: "soc-18", name: "Orchard Trail Park (Irvine)"                                   , lat: 33.7016, lng: -117.7132, courts: 1, address: "" },
  { id: "soc-38", name: "San Remo Park (Irvine)"                                        , lat: 33.6198, lng: -117.7391, courts: 1, address: "" },
  { id: "soc-60", name: "Serrano Creek Park (Irvine)"                                   , lat: 33.6488, lng: -117.7058, courts: 1, address: "" },
  { id: "soc-74", name: "Santa Vittoria Park (Irvine)"                                  , lat: 33.616, lng: -117.7417, courts: 1, address: "" },
  { id: "soc-81", name: "Cabrillo Park (Irvine)"                                        , lat: 33.7515, lng: -117.8392, courts: 1, address: "" },
  { id: "soc-98", name: "Gateway Park (Irvine)"                                         , lat: 33.6347, lng: -117.828, courts: 1, address: "" },
  { id: "soc-107", name: "Greenway Park (Irvine)"                                        , lat: 33.7401, lng: -117.7883, courts: 1, address: "" },
  { id: "soc-115", name: "Dave Robins Park (Irvine)"                                     , lat: 33.6601, lng: -117.8081, courts: 1, address: "" },
  { id: "soc-138", name: "Laguna Village Park (Irvine)"                                  , lat: 33.6231, lng: -117.7409, courts: 1, address: "" },

  // ----- La Habra -----
  { id: "soc-6", name: "Woodcrest Park (La Habra)"                                     , lat: 33.9455, lng: -117.9113, courts: 1, address: "" },

  // ----- Laguna Beach -----
  { id: "soc-62", name: "Alta Laguna Park (Laguna Beach)"                               , lat: 33.5558, lng: -117.7588, courts: 5, address: "" },
  { id: "soc-1", name: "Moulton Meadows Park (Laguna Beach)"                           , lat: 33.5286, lng: -117.7537, courts: 2, address: "", lit: true },
  { id: "soc-102", name: "Lang Park (Laguna Beach)"                                      , lat: 33.5131, lng: -117.7539, courts: 1, address: "" },

  // ----- Laguna Hills -----
  { id: "soc-89", name: "Ridgecrest Park (Laguna Hills)"                                , lat: 33.5949, lng: -117.7311, courts: 2, address: "" },
  { id: "soc-71", name: "Iglesia Park (Laguna Hills)"                                   , lat: 33.6058, lng: -117.7233, courts: 1, address: "" },

  // ----- Laguna Niguel -----
  { id: "soc-119", name: "Kite Hill Park (Laguna Niguel)"                                , lat: 33.5419, lng: -117.7142, courts: 6, address: "" },
  { id: "soc-45", name: "Laguna Niguel Regional Park (Laguna Niguel)"                   , lat: 33.5523, lng: -117.7131, courts: 4, address: "", lit: true },
  { id: "soc-79", name: "Hillview Park (Laguna Niguel)"                                 , lat: 33.5574, lng: -117.7201, courts: 3, address: "" },
  { id: "soc-124", name: "Rolling Hills Park (Laguna Niguel)"                            , lat: 33.5517, lng: -117.6859, courts: 2, address: "" },
  { id: "soc-75", name: "Upper Niguel Ranch Park (Laguna Niguel)"                       , lat: 33.5295, lng: -117.6984, courts: 1, address: "" },
  { id: "soc-76", name: "Niguel Ranch Park (Laguna Niguel)"                             , lat: 33.5241, lng: -117.6985, courts: 1, address: "" },
  { id: "soc-77", name: "Palm Court Park (Laguna Niguel)"                               , lat: 33.5152, lng: -117.6838, courts: 1, address: "" },
  { id: "soc-78", name: "Beacon Hill Park (Laguna Niguel)"                              , lat: 33.5032, lng: -117.7038, courts: 1, address: "" },
  { id: "soc-120", name: "Marina Hills Park (Laguna Niguel)"                             , lat: 33.519, lng: -117.699, courts: 1, address: "" },

  // ----- Lake Forest -----
  { id: "soc-14", name: "Foothill Ranch Community Park (Lake Forest)"                   , lat: 33.6794, lng: -117.6512, courts: 2, address: "" },
  { id: "soc-16", name: "Rancho Serrano Park (Lake Forest)"                             , lat: 33.6605, lng: -117.6918, courts: 2, address: "" },
  { id: "soc-85", name: "Oaks Tennis Park (Lake Forest)"                                , lat: 33.6742, lng: -117.6859, courts: 2, address: "" },
  { id: "soc-125", name: "El Toro Park (Lake Forest)"                                    , lat: 33.6155, lng: -117.6953, courts: 2, address: "" },
  { id: "soc-128", name: "Sycamore Park (Lake Forest)"                                   , lat: 33.6084, lng: -117.6907, courts: 2, address: "" },
  { id: "soc-19", name: "Tamarisk Park (Lake Forest)"                                   , lat: 33.6586, lng: -117.688, courts: 1, address: "" },
  { id: "soc-58", name: "Rimgate Park (Lake Forest)"                                    , lat: 33.6448, lng: -117.6783, courts: 1, address: "" },

  // ----- Lakewood -----
  { id: "soc-44", name: "Liberty Park (Lakewood)"                                       , lat: 33.8541, lng: -118.1001, courts: 6, address: "" },
  { id: "soc-37", name: "Mayfair Park (Lakewood)"                                       , lat: 33.8584, lng: -118.1328, courts: 5, address: "" },
  { id: "soc-264", name: "Ramona Park (Lakewood)"                                        , lat: 33.8729, lng: -118.1538, courts: 2, address: "" },
  { id: "soc-13", name: "Wardlow Park (Lakewood)"                                       , lat: 33.8208, lng: -118.1287, courts: 1, address: "" },
  { id: "soc-34", name: "Heartwell Park (Lakewood)"                                     , lat: 33.8306, lng: -118.1209, courts: 1, address: "" },
  { id: "soc-110", name: "Ruth R. Caruthers Park (Lakewood)"                             , lat: 33.879, lng: -118.1095, courts: 1, address: "", lit: true },

  // ----- Los Alamitos -----
  { id: "soc-23", name: "Laurel Park (Los Alamitos)"                                    , lat: 33.8042, lng: -118.0626, courts: 4, address: "" },
  { id: "soc-117", name: "Rossmoor Park (Los Alamitos)"                                  , lat: 33.7996, lng: -118.0768, courts: 4, address: "" },
  { id: "soc-97", name: "Heather Park (Los Alamitos)"                                   , lat: 33.7809, lng: -118.0524, courts: 2, address: "" },

  // ----- Mission Viejo -----
  { id: "soc-35", name: "Arroyo Vista Park (Mission Viejo)"                             , lat: 33.6255, lng: -117.6134, courts: 3, address: "" },
  { id: "soc-73", name: "Mackenzie Park (Mission Viejo)"                                , lat: 33.5963, lng: -117.6816, courts: 1, address: "" },

  // ----- Monterey Park -----
  { id: "soc-285", name: "George E Elder Park (Monterey Park)"                           , lat: 34.0404, lng: -118.1238, courts: 4, address: "" },
  { id: "soc-284", name: "Barnes Memorial Park (Monterey Park)"                          , lat: 34.0586, lng: -118.1271, courts: 3, address: "" },
  { id: "soc-231", name: "Sequoia Park (Monterey Park)"                                  , lat: 34.0538, lng: -118.1421, courts: 2, address: "" },
  { id: "soc-274", name: "Sunnyslopes Park (Monterey Park)"                              , lat: 34.0462, lng: -118.1515, courts: 2, address: "" },
  { id: "soc-282", name: "Garvey Ranch Park (Monterey Park)"                             , lat: 34.0518, lng: -118.1132, courts: 2, address: "" },
  { id: "soc-283", name: "Highlands Park (Monterey Park)"                                , lat: 34.0586, lng: -118.1531, courts: 2, address: "" },
  { id: "soc-250", name: "Belvedere Park (Monterey Park)"                                , lat: 34.0384, lng: -118.1591, courts: 1, address: "" },

  // ----- Moorpark -----
  { id: "soc-218", name: "Arroyo Vista Community Park (Moorpark)"                        , lat: 34.2728, lng: -118.8949, courts: 8, address: "" },
  { id: "soc-209", name: "Terra Rejada Park (Moorpark)"                                  , lat: 34.2675, lng: -118.8943, courts: 2, address: "" },
  { id: "soc-221", name: "Miller Park (Moorpark)"                                        , lat: 34.2735, lng: -118.8625, courts: 2, address: "" },
  { id: "soc-193", name: "Mammoth Highlands Park (Moorpark)"                             , lat: 34.3002, lng: -118.8678, courts: 1, address: "" },

  // ----- Moreno Valley -----
  { id: "soc-170", name: "John F. Kennedy Park (Moreno Valley)"                          , lat: 33.9023, lng: -117.2358, courts: 4, address: "" },
  { id: "soc-179", name: "Pedrorena Park (Moreno Valley)"                                , lat: 33.8872, lng: -117.2137, courts: 4, address: "" },
  { id: "soc-147", name: "Woodland Park (Moreno Valley)"                                 , lat: 33.9097, lng: -117.2137, courts: 2, address: "" },

  // ----- Newport Beach -----
  { id: "soc-84", name: "Upper Newport Bay Nature Preserve (Newport Beach)"             , lat: 33.642, lng: -117.8752, courts: 20, address: "", lit: true },
  { id: "soc-48", name: "Fairview Park (Newport Beach)"                                 , lat: 33.6605, lng: -117.9357, courts: 8, address: "" },
  { id: "soc-126", name: "San Joaquin Hills Park & Lawn Bowling Center (Newport Beach)"  , lat: 33.6085, lng: -117.8638, courts: 4, address: "" },
  { id: "soc-111", name: "Mariners Park (Newport Beach)"                                 , lat: 33.6332, lng: -117.9032, courts: 2, address: "" },
  { id: "soc-127", name: "Bonita Canyon Sports Park West (Newport Beach)"                , lat: 33.6277, lng: -117.8607, courts: 2, address: "" },
  { id: "soc-129", name: "Grant Howald Park (Newport Beach)"                             , lat: 33.6025, lng: -117.8708, courts: 2, address: "" },
  { id: "soc-132", name: "Tanager Park (Newport Beach)"                                  , lat: 33.6697, lng: -117.9291, courts: 2, address: "" },

  // ----- Norwalk -----
  { id: "soc-90", name: "Gerdes Park (Norwalk)"                                         , lat: 33.8979, lng: -118.0897, courts: 1, address: "" },

  // ----- Ontario -----
  { id: "soc-183", name: "Westwind Park (Ontario)"                                       , lat: 34.0203, lng: -117.5989, courts: 3, address: "" },
  { id: "soc-159", name: "Olympic Park (Ontario)"                                        , lat: 33.9934, lng: -117.6654, courts: 2, address: "", lit: true },
  { id: "soc-156", name: "Cypress Trails Park (Ontario)"                                 , lat: 34.0044, lng: -117.6621, courts: 1, address: "" },
  { id: "soc-158", name: "James R Bryant Park (Ontario)"                                 , lat: 34.0677, lng: -117.6596, courts: 1, address: "" },
  { id: "soc-160", name: "Creekside Park (Ontario)"                                      , lat: 34.0201, lng: -117.5834, courts: 1, address: "" },

  // ----- Orange -----
  { id: "soc-42", name: "Boysen Park (Orange)"                                          , lat: 33.8248, lng: -117.8908, courts: 12, address: "" },
  { id: "soc-41", name: "El Camino Real Park (Orange)"                                  , lat: 33.7945, lng: -117.87, courts: 6, address: "", lit: true },
  { id: "soc-56", name: "Olive Hills Park (Orange)"                                     , lat: 33.837, lng: -117.8242, courts: 6, address: "" },
  { id: "soc-92", name: "Broadmoor Park (Orange)"                                       , lat: 33.799, lng: -117.7737, courts: 6, address: "" },
  { id: "soc-40", name: "Steve Ambriz Memorial Park (Orange)"                           , lat: 33.8377, lng: -117.8569, courts: 2, address: "" },
  { id: "soc-95", name: "Anaheim Coves Park (Orange)"                                   , lat: 33.8355, lng: -117.8667, courts: 1, address: "" },

  // ----- Oxnard -----
  { id: "soc-188", name: "Oxnard Community Park West (Oxnard)"                           , lat: 34.1931, lng: -119.1904, courts: 8, address: "" },
  { id: "soc-224", name: "Walter B Moranda Park (Oxnard)"                                , lat: 34.1459, lng: -119.1931, courts: 4, address: "" },
  { id: "soc-185", name: "Peninsula Park (Oxnard)"                                       , lat: 34.1697, lng: -119.2261, courts: 2, address: "" },
  { id: "soc-204", name: "Marina West Park (Oxnard)"                                     , lat: 34.1858, lng: -119.2031, courts: 2, address: "" },
  { id: "soc-208", name: "Sierra Linda Park (Oxnard)"                                    , lat: 34.2271, lng: -119.189, courts: 2, address: "" },
  { id: "soc-222", name: "Lemonwood Park (Oxnard)"                                       , lat: 34.1781, lng: -119.1516, courts: 2, address: "" },
  { id: "soc-225", name: "Pleasant Valley Park (Oxnard)"                                 , lat: 34.1579, lng: -119.1702, courts: 2, address: "" },
  { id: "soc-227", name: "Via Marina Park (Oxnard)"                                      , lat: 34.1862, lng: -119.2118, courts: 2, address: "" },
  { id: "soc-186", name: "Carty Park (Oxnard)"                                           , lat: 34.165, lng: -119.1835, courts: 1, address: "" },
  { id: "soc-187", name: "Sea Air Park (Oxnard)"                                         , lat: 34.1932, lng: -119.2016, courts: 1, address: "" },
  { id: "soc-196", name: "Rio Lindo Park (Oxnard)"                                       , lat: 34.2236, lng: -119.1698, courts: 1, address: "" },
  { id: "soc-201", name: "River Ridge Playing Fields (Oxnard)"                           , lat: 34.2312, lng: -119.1979, courts: 1, address: "" },
  { id: "soc-206", name: "Wilson Park (Oxnard)"                                          , lat: 34.2054, lng: -119.1793, courts: 1, address: "" },
  { id: "soc-207", name: "Orchard Park (Oxnard)"                                         , lat: 34.2235, lng: -119.1811, courts: 1, address: "" },

  // ----- Pomona -----
  { id: "soc-168", name: "Palomares Park (Pomona)"                                       , lat: 34.0934, lng: -117.7433, courts: 4, address: "" },
  { id: "soc-177", name: "Washington Park (Pomona)"                                      , lat: 34.0484, lng: -117.7391, courts: 2, address: "" },

  // ----- Rancho Cucamonga -----
  { id: "soc-180", name: "Day Creek Park (Rancho Cucamonga)"                             , lat: 34.144, lng: -117.5348, courts: 4, address: "", lit: true },
  { id: "soc-181", name: "John Galvin Park (Rancho Cucamonga)"                           , lat: 34.0774, lng: -117.6316, courts: 3, address: "" },
  { id: "soc-151", name: "Lions Park (Rancho Cucamonga)"                                 , lat: 34.12, lng: -117.6044, courts: 2, address: "" },
  { id: "soc-143", name: "Beryl Park East (Rancho Cucamonga)"                            , lat: 34.1357, lng: -117.6083, courts: 1, address: "" },

  // ----- Rancho Santa Margarita -----
  { id: "soc-94", name: "Dove Canyon Community Park (Rancho Santa Margarita)"           , lat: 33.6377, lng: -117.5677, courts: 4, address: "" },
  { id: "soc-29", name: "Trabuco Mesa Park (Rancho Santa Margarita)"                    , lat: 33.655, lng: -117.5796, courts: 3, address: "", lit: true },
  { id: "soc-3", name: "Cielo Vista Park (Rancho Santa Margarita)"                     , lat: 33.6451, lng: -117.5876, courts: 2, address: "", lit: true },
  { id: "soc-49", name: "Monte Vista (Rancho Santa Margarita)"                          , lat: 33.6474, lng: -117.5929, courts: 2, address: "" },
  { id: "soc-66", name: "Country Hollow Lane Park (Rancho Santa Margarita)"             , lat: 33.6549, lng: -117.5731, courts: 1, address: "" },
  { id: "soc-118", name: "Altisima Park (Rancho Santa Margarita)"                        , lat: 33.6595, lng: -117.6184, courts: 1, address: "" },

  // ----- Redlands -----
  { id: "soc-142", name: "Ford Park (Redlands)"                                          , lat: 34.0428, lng: -117.159, courts: 5, address: "" },
  { id: "soc-148", name: "Caroline Park (Redlands)"                                      , lat: 34.0226, lng: -117.1605, courts: 1, address: "" },

  // ----- Riverside -----
  { id: "soc-153", name: "Andulka Park (Riverside)"                                      , lat: 33.9596, lng: -117.3494, courts: 9, address: "", lit: true },
  { id: "soc-154", name: "Reid Park (Riverside)"                                         , lat: 34.0132, lng: -117.3535, courts: 3, address: "" },
  { id: "soc-166", name: "Sunnymead Ranch Lake Club (Riverside)"                         , lat: 33.9684, lng: -117.251, courts: 3, address: "" },
  { id: "soc-144", name: "John Bryant Park (Riverside)"                                  , lat: 33.938, lng: -117.4608, courts: 2, address: "" },
  { id: "soc-146", name: "Thundersky Park (Riverside)"                                   , lat: 33.8915, lng: -117.3038, courts: 2, address: "" },
  { id: "soc-152", name: "Fairmount Park (Riverside)"                                    , lat: 33.9949, lng: -117.3716, courts: 2, address: "" },
  { id: "soc-173", name: "Taft Park (Riverside)"                                         , lat: 33.9273, lng: -117.3335, courts: 2, address: "" },
  { id: "soc-178", name: "A D Shamel Park (Riverside)"                                   , lat: 33.9444, lng: -117.3946, courts: 2, address: "" },
  { id: "soc-165", name: "Highgrove Community Park (Riverside)"                          , lat: 34.0187, lng: -117.3204, courts: 1, address: "" },
  { id: "soc-171", name: "Mount Rubidoux Park (Riverside)"                               , lat: 33.9814, lng: -117.3915, courts: 1, address: "" },

  // ----- Rowland Heights -----
  { id: "soc-267", name: "Ronald Reagan Park (Rowland Heights)"                          , lat: 33.9824, lng: -117.8531, courts: 3, address: "" },
  { id: "soc-254", name: "Pathfinder Community Regional Park (Rowland Heights)"          , lat: 33.9671, lng: -117.9132, courts: 2, address: "" },
  { id: "soc-266", name: "Rowland Heights Park (Rowland Heights)"                        , lat: 33.9898, lng: -117.8793, courts: 2, address: "" },

  // ----- San Bernardino -----
  { id: "soc-184", name: "Norton Recreation Center (San Bernardino)"                     , lat: 34.1033, lng: -117.2527, courts: 6, address: "" },
  { id: "soc-174", name: "Perris Hill Park (San Bernardino)"                             , lat: 34.1355, lng: -117.2667, courts: 5, address: "", lit: true },
  { id: "soc-145", name: "Long Park (San Bernardino)"                                    , lat: 34.0524, lng: -117.2343, courts: 1, address: "" },
  { id: "soc-162", name: "Nunez Park (San Bernardino)"                                   , lat: 34.1071, lng: -117.3253, courts: 1, address: "" },
  { id: "soc-163", name: "Manuel P. Moreno Jr. Park (San Bernardino)"                    , lat: 34.103, lng: -117.2843, courts: 1, address: "" },
  { id: "soc-164", name: "Lytle Creek Park (San Bernardino)"                             , lat: 34.0954, lng: -117.3104, courts: 1, address: "" },
  { id: "soc-175", name: "Blair Park (San Bernardino)"                                   , lat: 34.1509, lng: -117.3173, courts: 1, address: "" },

  // ----- San Clemente -----
  { id: "soc-53", name: "Marblehead Park (San Clemente)"                                , lat: 33.4519, lng: -117.6219, courts: 1, address: "" },

  // ----- San Marino -----
  { id: "soc-234", name: "Lacy Park (San Marino)"                                        , lat: 34.1206, lng: -118.1237, courts: 8, address: "" },

  // ----- Santa Ana -----
  { id: "soc-112", name: "Flower Street Park (Santa Ana)"                                , lat: 33.745, lng: -117.8754, courts: 10, address: "" },
  { id: "soc-141", name: "Santiago Park (Santa Ana)"                                     , lat: 33.7737, lng: -117.8594, courts: 3, address: "" },
  { id: "soc-130", name: "Morrison Park (Santa Ana)"                                     , lat: 33.7747, lng: -117.8795, courts: 2, address: "" },
  { id: "soc-134", name: "Hart Park (Santa Ana)"                                         , lat: 33.778, lng: -117.852, courts: 2, address: "" },

  // ----- Simi Valley -----
  { id: "soc-219", name: "Rancho Simi Community Park (Simi Valley)"                      , lat: 34.265, lng: -118.7621, courts: 6, address: "" },
  { id: "soc-205", name: "Rancho Tapo Community Park (Simi Valley)"                      , lat: 34.2875, lng: -118.7247, courts: 4, address: "", lit: true },
  { id: "soc-199", name: "Oakridge Estates Park (Simi Valley)"                           , lat: 34.2529, lng: -118.7769, courts: 2, address: "" },
  { id: "soc-194", name: "Santa Susana Park (Simi Valley)"                               , lat: 34.2594, lng: -118.6636, courts: 1, address: "" },

  // ----- Thousand Oaks -----
  { id: "soc-198", name: "Rancho Madera Community Park (Thousand Oaks)"                  , lat: 34.2489, lng: -118.8082, courts: 6, address: "", lit: true },
  { id: "soc-217", name: "Thousand Oaks Community Park (Thousand Oaks)"                  , lat: 34.2145, lng: -118.8692, courts: 4, address: "" },
  { id: "soc-226", name: "Wildflower Playfield (Thousand Oaks)"                          , lat: 34.2192, lng: -118.8966, courts: 4, address: "" },
  { id: "soc-213", name: "Triunfo Community Park (Thousand Oaks)"                        , lat: 34.1549, lng: -118.8455, courts: 3, address: "" },
  { id: "soc-192", name: "Rancho Conejo Playfields (Thousand Oaks)"                      , lat: 34.1915, lng: -118.9114, courts: 2, address: "" },
  { id: "soc-197", name: "Indian Springs Park (Thousand Oaks)"                           , lat: 34.1782, lng: -118.7809, courts: 2, address: "" },
  { id: "soc-211", name: "North Ranch Playfield (Thousand Oaks)"                         , lat: 34.1787, lng: -118.7898, courts: 2, address: "" },
  { id: "soc-212", name: "North Ranch Park (Thousand Oaks)"                              , lat: 34.1976, lng: -118.8197, courts: 1, address: "" },

  // ----- Upland -----
  { id: "soc-167", name: "Cahuilla Park (Upland)"                                        , lat: 34.1148, lng: -117.7241, courts: 8, address: "" },
  { id: "soc-155", name: "Memorial Park (Upland)"                                        , lat: 34.103, lng: -117.7193, courts: 1, address: "" },
  { id: "soc-157", name: "Mallows Park (Upland)"                                         , lat: 34.099, lng: -117.7195, courts: 1, address: "" },
  { id: "soc-169", name: "Blaisdell Park (Upland)"                                       , lat: 34.0876, lng: -117.7142, courts: 1, address: "" },

  // ----- Ventura -----
  { id: "soc-195", name: "Camino Real Park (Ventura)"                                    , lat: 34.2694, lng: -119.2343, courts: 8, address: "", lit: true },
  { id: "soc-215", name: "Brock Linear Park (Ventura)"                                   , lat: 34.3, lng: -119.2925, courts: 2, address: "" },
  { id: "soc-216", name: "Juanamaria Park (Ventura)"                                     , lat: 34.2837, lng: -119.1918, courts: 2, address: "" },
  { id: "soc-214", name: "Harry Lyon Park (Ventura)"                                     , lat: 34.3, lng: -119.2927, courts: 1, address: "" },

  // ----- West Covina -----
  { id: "soc-258", name: "Del Norte Park (West Covina)"                                  , lat: 34.0777, lng: -117.9355, courts: 4, address: "", lit: true },
  { id: "soc-247", name: "Covina Park (West Covina)"                                     , lat: 34.0879, lng: -117.8955, courts: 2, address: "" },

  // ----- Whittier -----
  { id: "soc-256", name: "Steinmetz Park (Whittier)"                                     , lat: 34.0018, lng: -117.9607, courts: 2, address: "" },

  // ----- Yorba Linda -----
  { id: "soc-39", name: "Las Palomas Park (Yorba Linda)"                                , lat: 33.8829, lng: -117.7734, courts: 3, address: "" },
];
