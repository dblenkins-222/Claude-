// Unit conversion helpers.
// Signal K delivers data in SI units:
//   speed        -> m/s
//   angle/course -> radians
//   temperature  -> Kelvin
//   depth/length -> meters
//   ratio (SOC, tank level) -> 0..1
//   voltage      -> volts, current -> amps, power -> watts
// These helpers convert to human-friendly display units.

export const MS_TO_KNOTS = 1.943844;
export const MS_TO_KMH = 3.6;
export const MS_TO_MPH = 2.236936;
export const M_TO_FEET = 3.280839895;
export const RAD_TO_DEG = 180 / Math.PI;

export function msToKnots(v) {
  return v == null ? null : v * MS_TO_KNOTS;
}

export function msToKmh(v) {
  return v == null ? null : v * MS_TO_KMH;
}

export function radToDeg(v) {
  if (v == null) return null;
  let deg = v * RAD_TO_DEG;
  // Normalise to 0..360 for compass-style values.
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

// Wind angle is signed (-180..180, negative = port). Keep the sign.
export function radToSignedDeg(v) {
  if (v == null) return null;
  let deg = v * RAD_TO_DEG;
  while (deg > 180) deg -= 360;
  while (deg < -180) deg += 360;
  return deg;
}

export function kelvinToCelsius(v) {
  return v == null ? null : v - 273.15;
}

export function kelvinToFahrenheit(v) {
  return v == null ? null : (v - 273.15) * 9 / 5 + 32;
}

export function ratioToPercent(v) {
  return v == null ? null : v * 100;
}

export function mToFeet(v) {
  return v == null ? null : v * M_TO_FEET;
}

// Format a number to a fixed number of decimals, returning a placeholder
// when the value is missing.
export function fmt(v, decimals = 1, placeholder = '--') {
  if (v == null || Number.isNaN(v)) return placeholder;
  return Number(v).toFixed(decimals);
}

// Compass point (N, NNE, NE ...) from degrees.
const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

export function degToCompassPoint(deg) {
  if (deg == null) return '';
  const idx = Math.round(deg / 22.5) % 16;
  return COMPASS_POINTS[idx];
}

// Decimal degrees -> "12° 34.567' N" style used on marine displays.
export function formatLatitude(lat) {
  if (lat == null) return '--';
  const hemi = lat >= 0 ? 'N' : 'S';
  return formatDegMin(Math.abs(lat)) + ' ' + hemi;
}

export function formatLongitude(lon) {
  if (lon == null) return '--';
  const hemi = lon >= 0 ? 'E' : 'W';
  return formatDegMin(Math.abs(lon)) + ' ' + hemi;
}

function formatDegMin(value) {
  const deg = Math.floor(value);
  const min = (value - deg) * 60;
  return `${deg}° ${min.toFixed(3)}'`;
}


// ---- Engine / pressure -----------------------------------------------------
// Signal K reports engine revolutions in Hz (revs per second).
export function hzToRpm(v) {
  return v == null ? null : v * 60;
}

// Pressure arrives in pascals.
export function paToBar(v) {
  return v == null ? null : v / 100000;
}

export function paToPsi(v) {
  return v == null ? null : v / 6894.757;
}

// ---- Geo helpers (AIS ranges/bearings + anchor watch) ----------------------
const EARTH_RADIUS_M = 6371000;
const NM_PER_M = 1 / 1852;

function toRad(d) {
  return d * Math.PI / 180;
}

// Great-circle distance between two lat/lon points, in meters.
export function haversineMeters(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || Number.isNaN(v))) return null;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Initial bearing (degrees, 0..360) from point 1 to point 2.
export function bearingDeg(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || Number.isNaN(v))) return null;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const brng = Math.atan2(y, x) * RAD_TO_DEG;
  return (brng + 360) % 360;
}

export function metersToNm(v) {
  return v == null ? null : v * NM_PER_M;
}

// Human-friendly range: meters when close, nautical miles when far.
export function formatRange(meters) {
  if (meters == null) return '--';
  if (meters < 1852) return `${Math.round(meters)} m`;
  return `${(meters * NM_PER_M).toFixed(2)} NM`;
}


// ---- Generator helpers -----------------------------------------------------
// Runtime is reported in seconds; show it in hours.
export function secondsToHours(v) {
  return v == null ? null : v / 3600;
}

// Power in watts -> kilowatts.
export function wToKw(v) {
  return v == null ? null : v / 1000;
}
