/**
 * Saved transport places (0123): coordinates, the destination they belong to, the straight-line
 * distance from LAF House and a free Google Maps directions link. Pure; `node --test` runs it.
 */

export interface Place {
  name: string;
  lat: number;
  lng: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** "14.627712, 121.026051" as Google Maps copies it, or a Google Maps link with "@lat,lng" or "q=lat,lng" in it. */
export function parseCoords(text: string): LatLng | null {
  const t = text.trim();
  const m = /(?:@|[?&](?:q|query|ll|destination)=)(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/.exec(t) ?? /^(-?\d{1,3}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

// Apostrophes vanish ("Children's" = "Childrens"); any other punctuation is a space.
const norm = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** The saved place a trip's destination names: the same words, or a short name inside the longer one ("NCH" for "NCH, Quezon City"). */
export function findPlace(places: readonly Place[], destination: string | null | undefined): Place | null {
  const d = norm(destination ?? "");
  if (!d) return null;
  return places.find((p) => norm(p.name) === d) ?? places.find((p) => norm(p.name).length >= 3 && (d.includes(norm(p.name)) || norm(p.name).includes(d))) ?? null;
}

/** Great-circle distance in km. */
export function straightKm(a: LatLng, b: LatLng): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Roads run about 1.3 times the straight line in Metro Manila; one way, rounded to the km. Only an estimate until trips are logged. */
export const ROAD_FACTOR = 1.3;
export function estimateRoadKm(from: LatLng, to: LatLng): number {
  return Math.max(1, Math.round(straightKm(from, to) * ROAD_FACTOR));
}

/** Directions in Google Maps (no key, no billing): opens the app on the driver's phone. */
export function directionsUrl(to: LatLng, from?: LatLng | null): string {
  const q = new URLSearchParams({ api: "1", destination: `${to.lat},${to.lng}`, travelmode: "driving" });
  if (from) q.set("origin", `${from.lat},${from.lng}`);
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

/** Saved places from the settings row, keeping only well-formed ones. */
export function placesFromSettings(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    const lat = Number(p?.lat);
    const lng = Number(p?.lng);
    return name && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [{ name: name.slice(0, 80), lat, lng }] : [];
  });
}
