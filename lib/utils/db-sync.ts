/**
 * The two-way database sync's decisions (0104): what to copy, delete and log, from three views of one
 * table -- the rows both sides agreed on after the last run (state), production's rows and dev's rows,
 * each as key -> hash of the shared columns. Pure; the route (/api/db-sync) reads and writes.
 *
 * Production wins: a row changed on both sides keeps production's version; a row production deleted
 * stays deleted even if dev changed it; a row dev deleted that production changed comes back to dev.
 * A change or a deletion on one side only is simply carried to the other.
 */
export type Hashes = ReadonlyMap<string, string>;

export interface Decision {
  /** Keys to copy production -> dev (upsert). */
  toDev: string[];
  /** Keys to copy dev -> production (upsert). */
  toProd: string[];
  deleteOnDev: string[];
  deleteOnProd: string[];
  conflicts: { pk: string; what: "production kept" | "production deletion stands" }[];
  /** What both sides hold once the actions are applied. */
  agreed: Map<string, string>;
}

export function decide(state: Hashes, prod: Hashes, dev: Hashes): Decision {
  const d: Decision = { toDev: [], toProd: [], deleteOnDev: [], deleteOnProd: [], conflicts: [], agreed: new Map() };
  for (const pk of new Set([...state.keys(), ...prod.keys(), ...dev.keys()])) {
    const s = state.get(pk);
    const p = prod.get(pk);
    const v = dev.get(pk);
    if (p !== undefined && v !== undefined) {
      if (p === v) d.agreed.set(pk, p);
      else if (s === p) {
        d.toProd.push(pk); // only dev changed
        d.agreed.set(pk, v);
      } else {
        if (s !== v) d.conflicts.push({ pk, what: "production kept" }); // both changed (or never agreed)
        d.toDev.push(pk);
        d.agreed.set(pk, p);
      }
    } else if (p !== undefined) {
      if (s === undefined) d.toDev.push(pk); // new on production
      else if (s === p) d.deleteOnProd.push(pk); // dev deleted it, production untouched
      else {
        d.conflicts.push({ pk, what: "production kept" }); // dev deleted, production changed
        d.toDev.push(pk);
      }
      if (!(s !== undefined && s === p)) d.agreed.set(pk, p);
    } else if (v !== undefined) {
      if (s === undefined) {
        d.toProd.push(pk); // new on dev
        d.agreed.set(pk, v);
      } else {
        if (s !== v) d.conflicts.push({ pk, what: "production deletion stands" }); // production deleted, dev changed
        d.deleteOnDev.push(pk);
      }
    }
    // Gone from both: nothing to do; it leaves the state.
  }
  return d;
}
