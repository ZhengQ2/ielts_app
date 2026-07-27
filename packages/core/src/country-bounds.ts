/**
 * A coarse, generous plausibility gate for "is this coordinate anywhere near
 * the country it claims to be in" — not a precise boundary.
 *
 * Built to catch what an embedded page coordinate cannot be trusted to avoid:
 * a real IELTS.org page for a Manchester, UK centre embedded
 * `center=53.48098,2.23259` — a sign error putting it over the North Sea
 * instead of at `-2.23259`W — and another, for a Hai Phong, Vietnam centre,
 * embedded the literal placeholder `center=1,1` (Gulf of Guinea). Neither
 * looks malformed on its own; both are nowhere near the stated country.
 *
 * Deliberately not exhaustive and not authoritative: boxes are wide on
 * purpose, so the risk runs toward missed coverage (falls back to trusting the
 * embed, today's behaviour) rather than flagging a real coordinate as
 * implausible. Extend by adding a country as its need comes up; there is no
 * requirement to cover every ISO code, only the ones this dataset touches.
 */

export interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** ISO 3166-1 alpha-2 → generous [minLat, maxLat, minLng, maxLng]. */
const COUNTRY_BOUNDS: Record<string, [number, number, number, number]> = {
  CA: [41, 84, -141, -52],
  US: [18, 72, -180, -65],
  MX: [14, 33, -118, -86],
  GB: [49, 61, -9, 2],
  IE: [51, 56, -11, -5],
  FR: [41, 51, -5, 9],
  DE: [47, 55, 5, 15],
  ES: [27, 44, -18, 5],
  PT: [30, 43, -32, -6],
  IT: [35, 48, 6, 19],
  NL: [50, 54, 3, 8],
  BE: [49, 52, 2, 7],
  LU: [49, 51, 5, 7],
  CH: [45, 48, 5, 11],
  AT: [46, 49, 9, 18],
  PL: [49, 55, 14, 25],
  CZ: [48, 51, 12, 19],
  SK: [47, 50, 16, 23],
  HU: [45, 49, 16, 23],
  RO: [43, 49, 20, 30],
  BG: [41, 45, 22, 29],
  GR: [34, 42, 19, 30],
  HR: [42, 47, 13, 20],
  RS: [42, 47, 18, 23],
  MD: [45, 49, 26, 30],
  NO: [57, 72, 4, 32],
  SE: [55, 70, 10, 25],
  FI: [59, 71, 19, 32],
  DK: [54, 58, 7, 16],
  EE: [57, 60, 21, 29],
  LV: [55, 59, 20, 29],
  LT: [53, 57, 20, 27],
  IS: [63, 67, -25, -12],
  UA: [44, 53, 22, 41],
  BY: [51, 57, 23, 33],
  RU: [41, 82, 19, 180],
  GE: [41, 44, 39, 47],
  AM: [38, 42, 43, 47],
  AZ: [38, 42, 44, 51],
  TR: [35, 43, 25, 45],
  CY: [34, 36, 32, 35],
  MT: [35, 36, 14, 15],
  EG: [22, 32, 24, 37],
  LY: [19, 34, 9, 26],
  TN: [30, 38, 7, 12],
  DZ: [18, 38, -9, 12],
  MA: [27, 36, -14, -1],
  SD: [8, 23, 21, 39],
  ET: [3, 15, 32, 48],
  KE: [-5, 6, 33, 42],
  TZ: [-13, 0, 28, 41],
  UG: [-2, 5, 29, 35],
  RW: [-3, -1, 28, 31],
  NG: [4, 14, 2, 15],
  GH: [4, 12, -4, 2],
  CI: [4, 11, -9, -2],
  SN: [12, 17, -18, -11],
  GM: [13, 14, -17, -13],
  TG: [5, 12, -1, 2],
  CM: [1, 14, 8, 17],
  ZA: [-35, -22, 16, 33],
  ZW: [-23, -15, 25, 34],
  ZM: [-19, -8, 21, 34],
  MW: [-18, -9, 32, 36],
  MZ: [-27, -10, 30, 41],
  NA: [-29, -16, 11, 26],
  BW: [-27, -17, 19, 30],
  SA: [15, 33, 33, 56],
  AE: [22, 27, 51, 57],
  OM: [16, 27, 51, 60],
  QA: [24, 27, 50, 52],
  KW: [28, 31, 46, 49],
  BH: [25, 27, 50, 51],
  YE: [11, 19, 41, 55],
  JO: [29, 34, 34, 40],
  LB: [33, 35, 35, 37],
  SY: [32, 38, 35, 43],
  IQ: [28, 38, 38, 49],
  IL: [29, 34, 33, 36],
  PS: [31, 33, 34, 36],
  IN: [6, 36, 68, 98],
  PK: [23, 38, 60, 78],
  BD: [20, 27, 88, 93],
  LK: [5, 10, 79, 82],
  NP: [26, 31, 80, 89],
  BT: [26, 29, 88, 93],
  MV: [-1, 8, 72, 74],
  CN: [17, 54, 73, 135],
  HK: [22, 23, 113, 115],
  MO: [22, 23, 113, 114],
  TW: [21, 26, 119, 123],
  JP: [24, 46, 122, 154],
  KR: [33, 39, 124, 132],
  MN: [41, 53, 87, 120],
  TH: [5, 21, 97, 106],
  VN: [8, 24, 102, 110],
  LA: [13, 23, 100, 108],
  KH: [10, 15, 102, 108],
  MM: [9, 29, 92, 102],
  MY: [0, 8, 99, 120],
  SG: [1, 2, 103, 104],
  ID: [-11, 7, 94, 142],
  PH: [4, 21, 116, 127],
  TL: [-10, -8, 124, 128],
  PG: [-12, 0, 140, 156],
  // Fiji is omitted: its territory straddles the antimeridian (180°), which
  // this table's plain min/max comparison can't represent (minLng > maxLng
  // would make every real coordinate register as implausible). Coverage gap,
  // not a wrong answer — falls back to trusting the embed, same as today.
  NC: [-23, -19, 163, 169],
  PF: [-28, -7, -155, -134],
  TO: [-22, -18, -176, -173],
  AU: [-44, -10, 112, 154],
  NZ: [-47, -34, 165, 179],
  KZ: [40, 56, 46, 88],
  UZ: [37, 46, 55, 74],
  TJ: [36, 41, 67, 75],
  KG: [39, 44, 69, 81],
  TM: [35, 43, 52, 67],
  AF: [29, 39, 60, 75],
  BR: [-34, 6, -74, -34],
  AR: [-56, -21, -74, -53],
  CL: [-56, -17, -76, -66],
  CO: [-5, 13, -82, -66],
  PE: [-19, 0, -82, -68],
  EC: [-5, 2, -92, -75],
  VE: [0, 13, -74, -59],
  UY: [-35, -30, -59, -53],
  PY: [-28, -19, -63, -54],
  BO: [-23, -9, -70, -57],
  GY: [1, 9, -62, -56],
  SR: [1, 6, -58, -54],
  CR: [8, 12, -87, -82],
  PA: [7, 10, -83, -77],
  NI: [10, 15, -88, -83],
  HN: [12, 17, -90, -83],
  GT: [13, 18, -93, -88],
  SV: [13, 15, -90, -87],
  BZ: [15, 19, -90, -87],
  CU: [19, 24, -85, -74],
  DO: [17, 20, -72, -68],
  JM: [17, 19, -79, -75],
  TT: [10, 12, -62, -60],
};

export function boundsFor(country: string | null | undefined): Bounds | null {
  if (!country) return null;
  const b = COUNTRY_BOUNDS[country.toUpperCase()];
  if (!b) return null;
  return { minLat: b[0], maxLat: b[1], minLng: b[2], maxLng: b[3] };
}

/**
 * Whether a coordinate is anywhere near plausible for the given country. With
 * no bounds on file for that country, this returns true (untested, not
 * disproven) — coverage gaps must never make a centre look wrong.
 */
export function isPlausibleForCountry(
  lat: number,
  lng: number,
  country: string | null | undefined,
): boolean {
  const b = boundsFor(country);
  if (!b) return true;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}
