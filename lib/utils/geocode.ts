import "server-only";

export interface ReverseGeocodeResult {
  /** Full human-readable address, e.g. "12 Banawe St, Santa Teresita, Quezon City, Metro Manila, 1114, Philippines". */
  addressLabel: string;
  /** The geocoder's raw response, stored verbatim alongside the label. */
  raw: unknown;
}

const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

/** Nominatim's usage policy requires a real identifying User-Agent with a way to
 * make contact. Overridable so a deployment can point it at its own address. */
const CONTACT =
  process.env.NOMINATIM_CONTACT ?? "LAF Operating System (https://github.com/mzprojects88/lafopsys)";

/** Policy allows at most 1 request/second; keep a little headroom. */
const MIN_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 8000;

/** ~11m at 4 decimal places -- two punches from the same room reuse one lookup. */
const CACHE_PRECISION = 4;
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, ReverseGeocodeResult>();

/** Serialises every outbound call so concurrent punches can't burst past the
 * 1 req/sec policy. Each caller waits on the previous one's gap. */
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function cacheKey(latitude: number, longitude: number): string {
  return `${latitude.toFixed(CACHE_PRECISION)},${longitude.toFixed(CACHE_PRECISION)}`;
}

/**
 * Turns coordinates into a full street address via OpenStreetMap Nominatim.
 *
 * Returns null on anything that isn't a confident answer -- unreachable service,
 * non-200, a response with no `display_name`, or a timeout. The caller records
 * that as `geocode_failed` and keeps the raw coordinates; a guessed or
 * partially-filled address would be worse than an honest blank.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const key = cacheKey(latitude, longitude);
  const cached = cache.get(key);
  if (cached) return cached;

  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();

    const url = new URL(NOMINATIM_REVERSE);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "18"); // building/street level
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url, {
      headers: { "User-Agent": CONTACT, "Accept-Language": "en" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { display_name?: string };
    const addressLabel = body?.display_name?.trim();
    if (!addressLabel) return null;

    return { addressLabel, raw: body } satisfies ReverseGeocodeResult;
  });

  // Keep the chain alive for the next caller even if this lookup throws.
  queue = run.catch(() => undefined);

  let result: ReverseGeocodeResult | null;
  try {
    result = await run;
  } catch {
    return null;
  }
  if (!result) return null;

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, result);
  return result;
}
