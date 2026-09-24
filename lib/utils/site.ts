/**
 * Was a punch made at LAF House (DTR plan phase 4, user 2026-09-24)? Within
 * the radius set in Settings (20 m) of the house's pin is on-site; anywhere
 * else is off-site, and the DTR shows the address the phone was at. Nothing
 * is refused. Pure, so tests/site.test.mjs runs it under node --test.
 *
 * ponytail: straight distance to one pin. Phones indoors are often off by
 * 20-60 m, so an honest punch at the house can read off-site; the DTR shows
 * the GPS accuracy beside the distance, and the radius is the knob.
 */

export type SiteStatus = "on_site" | "off_site" | "unknown";

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** On-site within the radius; unknown when the punch has no position or the house has no pin yet. */
export function siteOf(
  punch: { lat?: number | null; lng?: number | null },
  house: { lat: number | null; lng: number | null; radiusM: number }
): { status: SiteStatus; distanceM: number | null } {
  if (punch.lat == null || punch.lng == null || house.lat == null || house.lng == null) return { status: "unknown", distanceM: null };
  const d = Math.round(distanceMeters({ lat: punch.lat, lng: punch.lng }, { lat: house.lat, lng: house.lng }));
  return { status: d <= house.radiusM ? "on_site" : "off_site", distanceM: d };
}

/** "18 m", "1.2 km". */
export function formatDistance(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
