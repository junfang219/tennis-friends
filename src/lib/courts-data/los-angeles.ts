/**
 * Los Angeles metro tennis courts.
 *
 * Cities covered: LA City (LA Recreation & Parks), Santa Monica, Beverly Hills,
 * Culver City, Pasadena, Long Beach.
 *
 * Sources: LA Rec & Parks, santamonica.gov/programs/tennis,
 * beverlyhills.org/540/Tennis, cityofpasadena.net parks pages,
 * longbeach.gov/park sports pages. LA City's full per-facility court counts
 * live behind a booking system; top public facilities verified by cross-
 * reference with the LA Parks permit list. Coordinates geocoded to ~4
 * decimal accuracy.
 */

import type { BBox, CuratedCourt } from "./types";

export const LOS_ANGELES_BBOX: BBox = {
  south: 33.70,
  west: -118.70,
  north: 34.35,
  east: -118.00,
};

export const LOS_ANGELES_COURTS: CuratedCourt[] = [
  // ===== LA City (Dept of Recreation and Parks) =====
  { id: "la-1",  name: "Griffith Park - Riverside Tennis Courts",     lat: 34.1466, lng: -118.2858, courts: 12, address: "3401 Riverside Dr, Los Angeles, CA 90027" },
  { id: "la-2",  name: "Griffith Park - Vermont Canyon Tennis Courts", lat: 34.1275, lng: -118.2955, courts: 12, address: "2715 N Vermont Ave, Los Angeles, CA 90027" },
  { id: "la-3",  name: "Cheviot Hills Recreation Center",              lat: 34.0419, lng: -118.4116, courts: 14, address: "2551 Motor Ave, Los Angeles, CA 90064" },
  { id: "la-4",  name: "Balboa Sports Center",                         lat: 34.1797, lng: -118.4997, courts: 12, address: "17015 Burbank Blvd, Encino, CA 91316" },
  { id: "la-5",  name: "Encino Park",                                  lat: 34.1589, lng: -118.5009, courts: 6,  address: "16953 Ventura Blvd, Encino, CA 91316" },
  { id: "la-6",  name: "Van Nuys / Sherman Oaks Recreation Center",    lat: 34.1533, lng: -118.4517, courts: 8,  address: "14201 Huston St, Sherman Oaks, CA 91423" },
  { id: "la-7",  name: "Studio City Recreation Center (Beeman Park)", lat: 34.1494, lng: -118.3928, courts: 4,  address: "12621 Rye St, Studio City, CA 91604" },
  { id: "la-8",  name: "North Hollywood Recreation Center",            lat: 34.1722, lng: -118.3775, courts: 6,  address: "11430 Chandler Blvd, North Hollywood, CA 91601" },
  { id: "la-9",  name: "Westwood Recreation Center",                   lat: 34.0497, lng: -118.4443, courts: 8,  address: "1350 S Sepulveda Blvd, Los Angeles, CA 90025" },
  { id: "la-10", name: "Rancho Cienega Recreation Center",             lat: 34.0192, lng: -118.3389, courts: 8,  address: "5001 Rodeo Rd, Los Angeles, CA 90016" },
  { id: "la-11", name: "Poinsettia Recreation Center",                 lat: 34.0861, lng: -118.3525, courts: 6,  address: "7341 Willoughby Ave, Los Angeles, CA 90046" },
  { id: "la-12", name: "Plummer Park",                                 lat: 34.0903, lng: -118.3619, courts: 2,  address: "7377 Santa Monica Blvd, West Hollywood, CA 90046" },
  { id: "la-13", name: "Queen Anne Recreation Center",                 lat: 34.0622, lng: -118.3353, courts: 4,  address: "1240 West Blvd, Los Angeles, CA 90019" },
  { id: "la-14", name: "Reseda Park",                                  lat: 34.1997, lng: -118.5361, courts: 6,  address: "18411 Victory Blvd, Reseda, CA 91335" },
  { id: "la-15", name: "Woodley Park Tennis Courts",                   lat: 34.1747, lng: -118.4822, courts: 4,  address: "6350 Woodley Ave, Van Nuys, CA 91406" },
  { id: "la-16", name: "Lake Balboa / Anthony C. Beilenson Park",      lat: 34.1858, lng: -118.4961, courts: 4,  address: "6300 Balboa Blvd, Van Nuys, CA 91406" },
  { id: "la-17", name: "Mar Vista Recreation Center",                  lat: 34.0078, lng: -118.4292, courts: 8,  address: "11430 Woodbine St, Los Angeles, CA 90066" },
  { id: "la-18", name: "Penmar Recreation Center",                     lat: 33.9972, lng: -118.4597, courts: 4,  address: "1341 Lake St, Venice, CA 90291" },
  { id: "la-19", name: "Westchester Recreation Center",                lat: 33.9639, lng: -118.4164, courts: 6,  address: "7000 W Manchester Ave, Los Angeles, CA 90045" },
  { id: "la-20", name: "Palisades Recreation Center",                  lat: 34.0408, lng: -118.5264, courts: 3,  address: "851 Alma Real Dr, Pacific Palisades, CA 90272" },
  { id: "la-21", name: "Barrington Recreation Center",                 lat: 34.0603, lng: -118.4722, courts: 4,  address: "333 S Barrington Ave, Los Angeles, CA 90049" },
  { id: "la-22", name: "Stoner Recreation Center",                     lat: 34.0389, lng: -118.4497, courts: 4,  address: "1835 Stoner Ave, Los Angeles, CA 90025" },
  { id: "la-23", name: "Lincoln Park",                                 lat: 34.0700, lng: -118.2081, courts: 4,  address: "3501 Valley Blvd, Los Angeles, CA 90031" },
  { id: "la-24", name: "Highland Park Recreation Center",              lat: 34.1111, lng: -118.1903, courts: 4,  address: "6150 Piedmont Ave, Los Angeles, CA 90042" },
  { id: "la-25", name: "Ernest E. Debs Regional Park",                 lat: 34.0822, lng: -118.1903, courts: 4,  address: "4235 Monterey Rd, Los Angeles, CA 90032" },
  { id: "la-26", name: "South Park Recreation Center",                 lat: 33.9722, lng: -118.2681, courts: 4,  address: "345 E 51st St, Los Angeles, CA 90011" },
  { id: "la-27", name: "Harbor Regional Park",                         lat: 33.7944, lng: -118.2903, courts: 4,  address: "25820 S Vermont Ave, Harbor City, CA 90710" },
  { id: "la-28", name: "Peck Park Community Center",                   lat: 33.7600, lng: -118.3067, courts: 6,  address: "560 N Western Ave, San Pedro, CA 90732" },
  { id: "la-29", name: "Sycamore Grove Park",                          lat: 34.0928, lng: -118.2089, courts: 2,  address: "4702 N Figueroa St, Los Angeles, CA 90042" },
  { id: "la-30", name: "Pan Pacific Recreation Center",                lat: 34.0770, lng: -118.3456, courts: 2,  address: "7600 Beverly Blvd, Los Angeles, CA 90036" },
  { id: "la-31", name: "Ladera Park",                                  lat: 33.9889, lng: -118.3678, courts: 4,  address: "6027 Ladera Park Ave, Los Angeles, CA 90056" },

  // ===== Santa Monica =====
  { id: "la-32", name: "Reed Park",          lat: 34.0275, lng: -118.4961, courts: 6, address: "1133 7th St, Santa Monica, CA 90403" },
  { id: "la-33", name: "Ocean View Park",    lat: 34.0078, lng: -118.4836, courts: 6, address: "2701 Barnard Way, Santa Monica, CA 90405" },
  { id: "la-34", name: "Marine Park",        lat: 34.0100, lng: -118.4711, courts: 3, address: "1406 Marine St, Santa Monica, CA 90405" },
  { id: "la-35", name: "Memorial Park",      lat: 34.0278, lng: -118.4800, courts: 4, address: "1401 Olympic Blvd, Santa Monica, CA 90404" },
  { id: "la-36", name: "Clover Park",        lat: 34.0161, lng: -118.4558, courts: 2, address: "2600 Ocean Park Blvd, Santa Monica, CA 90405" },
  { id: "la-37", name: "Los Amigos Park",    lat: 34.0222, lng: -118.4722, courts: 1, address: "500 Hollister Ave, Santa Monica, CA 90405" },

  // ===== Beverly Hills =====
  { id: "la-38", name: "La Cienega Tennis Center", lat: 34.0669, lng: -118.3781, courts: 16, address: "325 S La Cienega Blvd, Beverly Hills, CA 90211" },
  { id: "la-39", name: "Roxbury Park",             lat: 34.0653, lng: -118.4078, courts: 4,  address: "471 S Roxbury Dr, Beverly Hills, CA 90212" },

  // ===== Culver City =====
  { id: "la-40", name: "Veterans Memorial Park", lat: 34.0103, lng: -118.3997, courts: 4, address: "4117 Overland Ave, Culver City, CA 90230" },
  { id: "la-41", name: "Fox Hills Park",         lat: 33.9844, lng: -118.3906, courts: 2, address: "6161 Green Valley Cir, Culver City, CA 90230" },
  { id: "la-42", name: "Lindberg Park",          lat: 34.0178, lng: -118.4047, courts: 2, address: "5041 Rhoda Way, Culver City, CA 90230" },

  // ===== Pasadena =====
  { id: "la-43", name: "Rose Bowl Tennis Center (Brookside Park)", lat: 34.1614, lng: -118.1714, courts: 10, address: "360 N Arroyo Blvd, Pasadena, CA 91103" },
  { id: "la-44", name: "Grant Park",      lat: 34.1469, lng: -118.1486, courts: 2, address: "232 S Michigan Ave, Pasadena, CA 91106" },
  { id: "la-45", name: "Washington Park", lat: 34.1703, lng: -118.1472, courts: 2, address: "710 E Washington Blvd, Pasadena, CA 91104" },
  { id: "la-46", name: "Victory Park",    lat: 34.1697, lng: -118.0903, courts: 8, address: "2575 Paloma St, Pasadena, CA 91107" },
  { id: "la-47", name: "Allendale Park",  lat: 34.1253, lng: -118.1367, courts: 2, address: "1130 S Marengo Ave, Pasadena, CA 91106" },
  { id: "la-48", name: "Villa Parke",     lat: 34.1589, lng: -118.1525, courts: 2, address: "363 E Villa St, Pasadena, CA 91101" },

  // ===== Long Beach =====
  { id: "la-49", name: "El Dorado Park Tennis Center",                  lat: 33.8133, lng: -118.0836, courts: 15, address: "2800 Studebaker Rd, Long Beach, CA 90815" },
  { id: "la-50", name: "Billie Jean King Tennis Center (Houghton Park)", lat: 33.8706, lng: -118.1889, courts: 8,  address: "6301 Myrtle Ave, Long Beach, CA 90805" },
  { id: "la-51", name: "Recreation Park",                                lat: 33.7831, lng: -118.1364, courts: 12, address: "4900 E 7th St, Long Beach, CA 90804" },
  { id: "la-52", name: "Silverado Park",                                 lat: 33.7967, lng: -118.2156, courts: 4,  address: "1545 W 31st St, Long Beach, CA 90810" },
  { id: "la-53", name: "Heartwell Park",                                 lat: 33.8247, lng: -118.1236, courts: 8,  address: "5801 E Parkcrest St, Long Beach, CA 90808" },
  { id: "la-54", name: "Somerset Park",                                  lat: 33.8353, lng: -118.1108, courts: 4,  address: "1500 E Carson St, Long Beach, CA 90807" },
  { id: "la-55", name: "Whaley Park",                                    lat: 33.7867, lng: -118.1089, courts: 4,  address: "5620 Atherton St, Long Beach, CA 90815" },
  { id: "la-56", name: "Pan American Park",                              lat: 33.8153, lng: -118.1089, courts: 4,  address: "5157 Centralia St, Long Beach, CA 90808" },
  { id: "la-57", name: "Los Cerritos Park",                              lat: 33.8294, lng: -118.1850, courts: 2,  address: "3750 Del Mar Ave, Long Beach, CA 90807" },
  { id: "la-58", name: "Marina Vista Park",                              lat: 33.7633, lng: -118.1119, courts: 4,  address: "5355 E Eliot St, Long Beach, CA 90803" },
  { id: "la-59", name: "Stearns Champions Park",                         lat: 33.7897, lng: -118.1289, courts: 4,  address: "4520 E 23rd St, Long Beach, CA 90815" },
];
