/**
 * Bed plans (0071): the fewest moves that bring the whole house within the
 * bed rules (0070) -- every room single-sex except one family, rooms filled
 * in order -- and, when asked, make room for a newcomer. The same rules as
 * ops.bed_rule_problem, judged on the END state, as ops.apply_bed_plan
 * judges it. Pure; relative imports so tests/ can run it under node --test.
 * The AI never invents a plan: it only chooses among these and explains.
 */
import type { Sex } from "./bed-rules.ts";

export interface PlanBed {
  id: string;
  code: string;
  roomId: string | null;
  roomOrder: number;
  roomName: string;
  capacity: number;
  /** Active and not locked: a bed a family may be moved onto. */
  usable: boolean;
}

export interface PlanPerson {
  /** A stay id; NEWCOMER for the family being admitted. */
  key: string;
  sex?: Sex;
  familyId?: string;
  /** Null for the newcomer until placed. */
  unitId: string | null;
  /** A hold: counts where it is, never moves. */
  fixed?: boolean;
  nightsHere?: number;
  /** Days until the expected check-out, when known. */
  leavesIn?: number;
}

export interface PlanMove {
  key: string;
  from: string | null;
  to: string;
}

export interface BedPlan {
  moves: PlanMove[];
  /** Lower is gentler: recent arrivals move before long-staying or soon-leaving families. */
  disruption: number;
}

export const NEWCOMER = "__newcomer__";

const clash = (a: PlanPerson, b: PlanPerson) => !!a.sex && !!b.sex && a.sex !== b.sex && !(a.familyId && a.familyId === b.familyId);

/** Does this arrangement keep every rule? (unitOf: person key -> bed id) */
export function isValidArrangement(people: PlanPerson[], beds: PlanBed[], unitOf: Map<string, string | null>, bedById = new Map(beds.map((b) => [b.id, b]))): boolean {
  const perBed = new Map<string, number>();
  const perRoom = new Map<string, PlanPerson[]>();
  const roomOf = new Map<string, PlanBed>();
  for (const p of people) {
    const u = unitOf.get(p.key);
    if (!u) {
      if (p.key === NEWCOMER) return false; // the newcomer must be placed
      continue;
    }
    const bed = bedById.get(u);
    if (!bed) return false;
    const n = (perBed.get(u) ?? 0) + 1;
    if (n > bed.capacity) return false;
    perBed.set(u, n);
    if (bed.roomId) {
      roomOf.set(p.key, bed);
      const here = perRoom.get(bed.roomId);
      // Single-sex rooms, families excepted.
      if (here) {
        if (here.some((o) => clash(o, p))) return false;
        here.push(p);
      } else perRoom.set(bed.roomId, [p]);
    }
  }
  // Rooms in order: nobody sits in a later room while an earlier room that
  // would take them still has a free usable bed. Holds are placements already made.
  const freeRooms = new Set(beds.filter((b) => b.roomId && b.usable && (perBed.get(b.id) ?? 0) < b.capacity).map((b) => b.roomId!));
  const roomOrder = new Map(beds.filter((b) => b.roomId).map((b) => [b.roomId!, b.roomOrder]));
  for (const p of people) {
    if (p.fixed || !p.sex) continue;
    const mine = roomOf.get(p.key);
    if (!mine) continue;
    for (const roomId of freeRooms) {
      if ((roomOrder.get(roomId) ?? 0) >= mine.roomOrder) continue;
      if ((perRoom.get(roomId) ?? []).some((o) => clash(o, p))) continue;
      return false;
    }
  }
  return true;
}

/** How hard a plan is on the families: each move costs, more for a long stay
 * or someone leaving by tomorrow, and more again for moving away from Room 1. */
function disruptionOf(moves: PlanMove[], people: Map<string, PlanPerson>, bedById: Map<string, PlanBed>): number {
  let d = 0;
  for (const m of moves) {
    if (m.key === NEWCOMER) continue;
    const p = people.get(m.key);
    const away = (bedById.get(m.to)?.roomOrder ?? 0) - (bedById.get(m.from ?? "")?.roomOrder ?? 0);
    d += 10 + (p?.nightsHere ?? 0) + (p?.leavesIn !== undefined && p.leavesIn <= 1 ? 20 : 0) + Math.max(0, away) * 5;
  }
  return d;
}


type Label = "F" | "M" | "E";

/** How hard it is to move this family: the ones kept in place are the costliest to move. */
const stayCost = (p: PlanPerson) => (p.nightsHere ?? 0) + (p.leavesIn !== undefined && p.leavesIn <= 1 ? 20 : 0);

/**
 * Exact and fast for the usual house: label every room women's, men's or
 * empty (3^rooms ways), and for each labelling keep as many families where
 * they are as the rules allow, filling each sex's rooms in order. Returns
 * null when a family with carers of both sexes is in the house -- then the
 * move-by-move search below decides.
 */
function planByRooms(people: PlanPerson[], beds: PlanBed[], byKey: Map<string, PlanPerson>, bedById: Map<string, PlanBed>): BedPlan[] | null {
  const families = new Map<string, Set<Sex>>();
  for (const p of people) if (p.familyId && p.sex) families.set(p.familyId, (families.get(p.familyId) ?? new Set()).add(p.sex));
  if ([...families.values()].some((sexes) => sexes.size > 1)) return null;

  const rooms = [...new Map(beds.filter((b) => b.roomId).map((b) => [b.roomId!, b])).values()].sort((a, b) => a.roomOrder - b.roomOrder);
  const usableBeds = (roomId: string) => beds.filter((b) => b.roomId === roomId && b.usable).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  // Who stays put whatever happens: holds, anyone whose sex is unknown, anyone on a locked or unplaced bed.
  const pinned = people.filter((p) => {
    if (p.key === NEWCOMER) return false;
    const bed = bedById.get(p.unitId ?? "");
    return p.fixed || !p.sex || !bed || !bed.usable || !bed.roomId;
  });
  const pinnedKeys = new Set(pinned.map((p) => p.key));
  const movers = people.filter((p) => !pinnedKeys.has(p.key) && p.sex);
  const plans: BedPlan[] = [];

  const labelings: Label[][] = [[]];
  for (let i = 0; i < rooms.length; i++) labelings.splice(0, labelings.length, ...labelings.flatMap((l) => (["F", "M", "E"] as Label[]).map((x) => [...l, x])));

  for (const labels of labelings) {
    const labelOf = new Map(rooms.map((r, i) => [r.roomId!, labels[i]!]));
    // Pinned people with a sex must already be in a room of their label.
    if (pinned.some((p) => p.sex && bedById.get(p.unitId ?? "")?.roomId && labelOf.get(bedById.get(p.unitId!)!.roomId!) !== p.sex)) continue;
    const unitOf = new Map<string, string | null>(pinned.map((p) => [p.key, p.unitId]));
    const used = new Map<string, number>();
    for (const p of pinned) if (p.unitId) used.set(p.unitId, (used.get(p.unitId) ?? 0) + 1);
    let ok = true;
    for (const sex of ["F", "M"] as Sex[]) {
      const myRooms = rooms.filter((r) => labelOf.get(r.roomId!) === sex);
      const mine = movers.filter((p) => p.sex === sex);
      // Room by room, in order: keep the costliest families already there, fill the rest.
      const pool = [...mine].sort((a, b) => stayCost(b) - stayCost(a));
      const placed = new Set<string>();
      for (const r of myRooms) {
        const slots = usableBeds(r.roomId!).flatMap((b) => Array.from({ length: Math.max(0, b.capacity - (used.get(b.id) ?? 0)) }, () => b.id));
        const keepHere = pool.filter((p) => !placed.has(p.key) && bedById.get(p.unitId ?? "")?.roomId === r.roomId);
        for (const p of keepHere) {
          const i = slots.indexOf(p.unitId!);
          if (i < 0) continue;
          slots.splice(i, 1);
          unitOf.set(p.key, p.unitId);
          used.set(p.unitId!, (used.get(p.unitId!) ?? 0) + 1);
          placed.add(p.key);
        }
        // Free beds go first to those who must move anyway (wrong room, the
        // newcomer), then to whoever is cheapest to move.
        const inOwnRoom = (x: PlanPerson) => labelOf.get(bedById.get(x.unitId ?? "")?.roomId ?? "") === sex;
        const fillers = pool.filter((x) => !placed.has(x.key)).sort((a, b) => Number(inOwnRoom(a)) - Number(inOwnRoom(b)) || stayCost(a) - stayCost(b));
        for (const p of fillers) {
          if (!slots.length) break;
          const to = slots.shift()!;
          unitOf.set(p.key, to);
          used.set(to, (used.get(to) ?? 0) + 1);
          placed.add(p.key);
        }
      }
      if (placed.size < mine.length) ok = false;
    }
    if (!ok) continue;
    for (const p of movers) if (!unitOf.has(p.key)) unitOf.set(p.key, p.unitId);
    if (!isValidArrangement(people, beds, unitOf, bedById)) continue;
    const moves = [...unitOf]
      .filter(([key, to]) => to && to !== byKey.get(key)?.unitId)
      .map(([key, to]) => ({ key, from: byKey.get(key)?.unitId ?? null, to: to! }));
    plans.push({ moves, disruption: disruptionOf(moves, byKey, bedById) });
  }
  return plans;
}

/**
 * Every arrangement within `maxMoves` moves of families already in the house
 * (placing the newcomer is not a move), found by widening search: plans with
 * fewer moves always come first, then the gentlest. Nothing to do -> [].
 * Room by room (planByRooms) when it can; a family with carers of both sexes
 * falls back to breadth-first over moves and swaps, capped at `maxMoves` and
 * `timeLimitMs` (ponytail: fine for 13 beds; a bigger house wants a solver).
 */
export function findBedPlans(people: PlanPerson[], beds: PlanBed[], opts: { maxMoves?: number; limit?: number; timeLimitMs?: number } = {}): BedPlan[] {
  const maxMoves = opts.maxMoves ?? 4;
  const limit = opts.limit ?? 5;
  const deadline = Date.now() + (opts.timeLimitMs ?? 4000);
  const start = new Map(people.map((p) => [p.key, p.unitId]));
  const byKey = new Map(people.map((p) => [p.key, p]));
  const bedById = new Map(beds.map((b) => [b.id, b]));
  const hasNewcomer = byKey.has(NEWCOMER);
  if (!hasNewcomer && isValidArrangement(people, beds, start)) return [];

  const byRooms = planByRooms(people, beds, byKey, bedById);
  if (byRooms) return rank(byRooms, limit);

  const usable = beds.filter((b) => b.usable);
  const movable = people.filter((p) => !p.fixed);
  const keyOf = (m: Map<string, string | null>) => movable.map((p) => `${p.key}:${m.get(p.key) ?? "-"}`).join("|");
  const seen = new Set<string>([keyOf(start)]);
  let frontier: { unitOf: Map<string, string | null>; moves: PlanMove[] }[] = [{ unitOf: start, moves: [] }];
  const found: BedPlan[] = [];

  const count = (unitOf: Map<string, string | null>, bedId: string) => people.filter((p) => unitOf.get(p.key) === bedId).length;
  const movesOf = (moves: PlanMove[]) => moves.filter((m) => m.key !== NEWCOMER).length;

  // Each step moves one family to a bed with room, or swaps two families.
  for (let step = 0; step < maxMoves + (hasNewcomer ? 1 : 0) && !found.length; step++) {
    const next: typeof frontier = [];
    for (const { unitOf, moves } of frontier) {
      if (Date.now() > deadline) break;
      const tryState = (m: Map<string, string | null>, added: PlanMove[]) => {
        const all = [...moves, ...added];
        if (movesOf(all) > maxMoves) return;
        const k = keyOf(m);
        if (seen.has(k)) return;
        seen.add(k);
        if (isValidArrangement(people, beds, m, bedById)) found.push({ moves: collapse(all, start), disruption: disruptionOf(collapse(all, start), byKey, bedById) });
        else next.push({ unitOf: m, moves: all });
      };
      for (const p of movable) {
        const from = unitOf.get(p.key) ?? null;
        for (const b of usable) {
          if (b.id === from) continue;
          if (count(unitOf, b.id) < b.capacity) {
            const m = new Map(unitOf);
            m.set(p.key, b.id);
            tryState(m, [{ key: p.key, from, to: b.id }]);
          }
        }
      }
      for (let i = 0; i < movable.length; i++) {
        for (let j = i + 1; j < movable.length; j++) {
          const a = movable[i]!, b = movable[j]!;
          const ua = unitOf.get(a.key) ?? null, ub = unitOf.get(b.key) ?? null;
          if (!ua || !ub || ua === ub) continue;
          if (!beds.find((x) => x.id === ua)?.usable || !beds.find((x) => x.id === ub)?.usable) continue;
          const m = new Map(unitOf);
          m.set(a.key, ub);
          m.set(b.key, ua);
          tryState(m, [{ key: a.key, from: ua, to: ub }, { key: b.key, from: ub, to: ua }]);
        }
      }
    }
    frontier = next;
  }
  return rank(found, limit);
}

const familyMoves = (moves: PlanMove[]) => moves.filter((m) => m.key !== NEWCOMER).length;

/** Distinct plans, fewest moves first, then the gentlest. */
function rank(plans: BedPlan[], limit: number): BedPlan[] {
  const unique = new Map<string, BedPlan>();
  for (const plan of plans) {
    const k = plan.moves.map((m) => `${m.key}>${m.to}`).sort().join(",");
    if (!unique.has(k)) unique.set(k, plan);
  }
  return [...unique.values()].sort((a, b) => familyMoves(a.moves) - familyMoves(b.moves) || a.disruption - b.disruption).slice(0, limit);
}

/** One move per family, from where they are now to where they end. */
function collapse(moves: PlanMove[], start: Map<string, string | null>): PlanMove[] {
  const end = new Map<string, string>();
  for (const m of moves) end.set(m.key, m.to);
  return [...end].filter(([key, to]) => start.get(key) !== to).map(([key, to]) => ({ key, from: start.get(key) ?? null, to }));
}
