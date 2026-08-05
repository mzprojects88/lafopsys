/**
 * Deterministic PRNG for mock data. Plain Math.random() at module scope would
 * produce different values on the server render vs. the client hydration pass
 * and trigger hydration mismatches — every mock-data generator seeds from this
 * instead so output is identical across environments and across reloads.
 */
export function mulberry32(seed: number) {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed: number) {
  const random = mulberry32(seed);

  function int(min: number, max: number) {
    return Math.floor(random() * (max - min + 1)) + min;
  }

  function pick<T>(arr: readonly T[]): T {
    return arr[int(0, arr.length - 1)];
  }

  function pickN<T>(arr: readonly T[], n: number): T[] {
    const pool = [...arr];
    const out: T[] = [];
    for (let i = 0; i < n && pool.length > 0; i++) {
      out.push(pool.splice(int(0, pool.length - 1), 1)[0]);
    }
    return out;
  }

  function bool(probabilityTrue = 0.5) {
    return random() < probabilityTrue;
  }

  function daysFromNow(days: number, base = new Date("2026-08-04T00:00:00Z")) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  return { random, int, pick, pickN, bool, daysFromNow };
}

export const TODAY_ISO = "2026-08-04";
