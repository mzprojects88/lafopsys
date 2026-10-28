/** Simple in-memory, per-instance rolling-window rate limiter for API routes.
 * Resets on cold start/new instance -- this is deliberately basic (no shared
 * store), meant to blunt casual abuse/runaway loops against metered
 * third-party APIs, not to withstand a determined distributed attacker. */
const hits = new Map<string, number[]>();

export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    hits.set(key, timestamps);
    return true;
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return false;
}

/** Forget a key's history -- e.g. once a login succeeds, so earlier failed
 * attempts against that account stop counting toward the next lockout. */
export function clearRateLimit(key: string): void {
  hits.delete(key);
}
