/**
 * Distance between two coordinates, in metres (A83).
 *
 * Haversine on a sphere. The earth is not a sphere, so this is off by up to ~0.5% - about 1 m over
 * a 200 m geofence, which is an order of magnitude smaller than the GPS error it is measuring
 * against. A more exact ellipsoidal formula would add nothing a phone could actually resolve.
 */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8; // mean earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}

/** A coordinate a device could actually have reported. Rejects NaN, nulls and out-of-range values. */
export function isValidCoord(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0) // null island: a device with no fix, not a place anyone works
  );
}
