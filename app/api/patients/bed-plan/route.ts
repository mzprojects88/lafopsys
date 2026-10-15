import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chooseBedPlan, type BedPlanPerson } from "@/lib/ai/openai";
import { openaiConfigured } from "@/lib/ai/env";
import { ARRIVAL_PREFIX, NEWCOMER, findBedPlans, isArrival, type PlanBed, type PlanPerson } from "@/lib/utils/bed-plan";
import { todayIso } from "@/lib/utils/date";

export const maxDuration = 60;

type Sex = "F" | "M";
const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/**
 * "Suggest bed plan" (bed rules, 0071). Reads the house with the caller's
 * session (RLS decides what they see), finds the rearrangements that keep the
 * bed rules with the fewest moves (lib/utils/bed-plan.ts) -- making room for
 * a family arriving when `newcomer` is given -- and has the AI choose one and
 * explain it. The AI sees letters, sex, family tags, nights and days to
 * check-out; it only chooses among plans the code found, and
 * ops.apply_bed_plan checks the chosen one again when it is applied.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { newcomer?: { sex?: unknown; familyId?: unknown }; arrivals?: unknown };
  // Tonight's arrivals, placed together (bed plan polish, 2026-10-15): "new:<id>", the carer's sex, the family.
  const arrivals = (Array.isArray(body.arrivals) ? body.arrivals : [])
    .slice(0, 20)
    .flatMap((a: { key?: unknown; sex?: unknown; familyId?: unknown }) =>
      typeof a?.key === "string" && /^new:[0-9a-f-]{36}$/i.test(a.key) && (a.sex === "F" || a.sex === "M")
        ? [{ key: a.key, sex: a.sex as Sex, familyId: typeof a.familyId === "string" ? a.familyId : undefined }]
        : []
    );
  const newcomerSex = body.newcomer?.sex === "F" || body.newcomer?.sex === "M" ? (body.newcomer.sex as Sex) : null;
  if (body.newcomer && !newcomerSex) return NextResponse.json({ ok: false, error: "Say whether the arriving carer is a woman or a man." }, { status: 400 });

  const ops = supabase.schema("ops");
  const [units, rooms, positions, stays, holds] = await Promise.all([
    ops.from("units").select("id, code, room_id, active, status, capacity, temporary"),
    ops.from("rooms").select("id, name, sort_order"),
    ops.from("bed_positions").select("id, unit_id"),
    ops.from("stays").select("id, patient_id, bed_position_id, carer_id, check_in_at, expected_checkout_at, visit_id").in("status", ["in_house", "overdue"]),
    ops.from("bed_reservations").select("id, unit_id, patient_id, carer_sex").eq("status", "active"),
  ]);
  const failed = [units, rooms, positions, stays, holds].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ ok: false, error: failed.error.message }, { status: 500 });
  // The first night of each open visit (0089).
  const visitIds = [...new Set((stays.data ?? []).map((s) => s.visit_id ?? s.id))];
  const firstNights = visitIds.length ? await ops.from("stays").select("visit_id, check_in_at").in("visit_id", visitIds).order("check_in_at") : { data: [] as { visit_id: string; check_in_at: string }[] };
  const visitStart = new Map<string, string>();
  for (const n of firstNights.data ?? []) if (!visitStart.has(n.visit_id)) visitStart.set(n.visit_id, n.check_in_at);

  const patientIds = [...new Set((stays.data ?? []).map((s) => s.patient_id as string))];
  const carerIds = (stays.data ?? []).flatMap((s) => (s.carer_id ? [s.carer_id as string] : []));
  const [patients, carers] = await Promise.all([
    patientIds.length ? ops.from("patients").select("id, sex, family_id").in("id", patientIds) : Promise.resolve({ data: [], error: null }),
    carerIds.length ? ops.from("carers").select("id, sex").in("id", carerIds) : Promise.resolve({ data: [], error: null }),
  ]);

  const roomById = new Map((rooms.data ?? []).map((r) => [r.id as string, r]));
  const beds: PlanBed[] = (units.data ?? [])
    .filter((u) => u.active)
    .map((u) => {
      const room = u.room_id ? roomById.get(u.room_id) : undefined;
      return {
        id: u.id,
        code: u.code,
        roomId: room ? (room.id as string) : null,
        roomOrder: room ? Number(room.sort_order) : Number.MAX_SAFE_INTEGER,
        roomName: room ? (room.name as string) : "Unplaced",
        capacity: Number(u.capacity),
        usable: u.status === "available",
        temporary: Boolean(u.temporary),
      };
    });
  const bedLabel = (unitId: string | null) => {
    const b = beds.find((x) => x.id === unitId);
    return b ? `${b.code} (${b.roomName})` : null;
  };
  const unitOfPosition = new Map((positions.data ?? []).map((p) => [p.id as string, p.unit_id as string]));
  const patientById = new Map((patients.data ?? []).map((p) => [p.id as string, p]));
  const carerSex = new Map((carers.data ?? []).map((c) => [c.id as string, c.sex as Sex | null]));
  const today = todayIso();

  const people: PlanPerson[] = (stays.data ?? []).map((s) => {
    const patient = patientById.get(s.patient_id);
    const sex = (s.carer_id ? carerSex.get(s.carer_id) : patient?.sex) ?? undefined;
    return {
      key: s.id,
      sex: sex ?? undefined,
      familyId: patient?.family_id ?? undefined,
      unitId: unitOfPosition.get(s.bed_position_id) ?? null,
      // A stay is one night (0089): the visit's first night is what counts.
      nightsHere: daysBetween(visitStart.get(s.visit_id ?? s.id) ?? s.check_in_at, today),
      leavesIn: s.expected_checkout_at ? daysBetween(today, s.expected_checkout_at) : undefined,
    };
  });
  for (const h of holds.data ?? []) people.push({ key: `hold:${h.id}`, sex: h.carer_sex ?? undefined, familyId: undefined, unitId: h.unit_id, fixed: true });
  if (newcomerSex) people.push({ key: NEWCOMER, sex: newcomerSex, familyId: typeof body.newcomer?.familyId === "string" ? body.newcomer.familyId : undefined, unitId: null });
  // As many of tonight's arrivals as the rules allow, in the order sent (NCH's priority): if all of
  // them don't fit, the last ones wait and are named, instead of no plan at all. Binary search on how
  // many fit (about four searches for twelve arrivals).
  // ponytail: assumes fewer arrivals never fit worse; a best-subset search if evenings get bigger.
  const withFirst = (n: number) => [...people, ...arrivals.slice(0, n).map((a) => ({ key: a.key, sex: a.sex, familyId: a.familyId, unitId: null as string | null }))];
  const plansFor = (n: number) => findBedPlans(withFirst(n), beds, { timeLimitMs: 1500 });
  let placedArrivals = arrivals.length;
  let plans = plansFor(placedArrivals);
  if (!plans.length && arrivals.length) {
    let lo = 0;
    let hi = arrivals.length - 1;
    let best = { n: 0, plans: plansFor(0) };
    while (lo <= hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const p = mid === 0 ? best.plans : plansFor(mid);
      if (p.length || mid === 0) {
        if (mid >= best.n) best = { n: mid, plans: p };
        lo = mid + 1;
      } else hi = mid - 1;
    }
    placedArrivals = best.n;
    plans = best.plans;
  }
  people.push(...withFirst(placedArrivals).slice(people.length));
  const waiting = arrivals.slice(placedArrivals).map((a) => a.key);
  if (!plans.length) {
    return NextResponse.json({
      ok: true,
      plans: [],
      waiting,
      message: newcomerSex || arrivals.length
        ? "No arrangement within the rules has a bed for everyone arriving. Place them one at a time, or an admin can place someone outside the rules, with a reason."
        : "The house already keeps the bed rules: nothing to move.",
    });
  }

  // The AI chooses among the plans and explains; without it, the gentlest plan and a plain note.
  const tags = new Map<string, string>();
  const tagOf = (familyId?: string) => (familyId ? (tags.get(familyId) ?? tags.set(familyId, `F${tags.size + 1}`).get(familyId)!) : null);
  const aiPeople: BedPlanPerson[] = people
    .filter((p) => !p.fixed)
    .map((p) => ({
      id: p.key === NEWCOMER ? "new" : p.key,
      sex: p.sex ?? null,
      familyTag: tagOf(p.familyId),
      nightsHere: p.nightsHere ?? null,
      leavesInDays: p.leavesIn ?? null,
      now: bedLabel(p.unitId),
    }));
  let chosen = 0;
  let explanation = "The plan with the fewest moves that keeps the rooms single-sex and fills Room 1 first.";
  let reasons: Record<string, string> = {};
  let letters: Record<string, string> = {};
  let ai = false;
  if (plans.length && openaiConfigured()) {
    try {
      const pick = await chooseBedPlan(
        aiPeople,
        plans.map((p) => ({ moves: p.moves.map((m) => ({ personId: m.key === NEWCOMER ? "new" : m.key, to: bedLabel(m.to) ?? m.to })) }))
      );
      chosen = pick.index;
      explanation = pick.explanation;
      reasons = pick.reasons;
      letters = pick.letters;
      ai = true;
    } catch {
      // The plans stand without the AI's words.
    }
  }

  return NextResponse.json({
    ok: true,
    ai,
    chosen,
    explanation,
    // "Family A" -> a stay id ("new" = the family arriving); the app puts names back.
    letters,
    plans: plans.map((p, i) => ({
      moves: p.moves.map((m) => ({
        stayId: isArrival(m.key) ? null : m.key,
        // Which arrival a placement is for ("new:<id>"); null for a family already in the house.
        arrivalKey: m.key.startsWith(ARRIVAL_PREFIX) ? m.key : null,
        fromUnitId: m.from,
        toUnitId: m.to,
        reason: reasons[m.key === NEWCOMER ? "new" : m.key] ?? (isArrival(m.key) ? "Bed for the family arriving" : `To ${bedLabel(m.to)}: keeps the bed rules`),
      })),
      // Why not this one, in a line (never for the suggested plan).
      whyNot: i === chosen ? null : whyNot(p, plans[chosen]!),
    })),
    // The house as the planner saw it -- keys, sexes, families, beds; no names -- so the social
    // worker can leave a move out and see at once whether the rest still keeps the rules.
    layout: { people, beds },
    // Arrivals for whom no bed within the rules was found tonight.
    waiting,
  });
}

const familyMovesOf = (p: { moves: { key: string }[] }) => p.moves.filter((m) => !isArrival(m.key)).length;

/** One plain line comparing a plan with the suggested one. */
function whyNot(plan: { moves: { key: string }[]; disruption: number }, best: { moves: { key: string }[]; disruption: number }): string {
  const mine = familyMovesOf(plan);
  const theirs = familyMovesOf(best);
  if (mine > theirs) return `Moves ${mine} ${mine === 1 ? "family" : "families"}; the suggested plan moves ${theirs}.`;
  if (mine < theirs) return `Moves fewer families, but they have stayed longer or leave sooner.`;
  return plan.disruption > best.disruption ? "Same number of moves, but it moves families who have stayed longer, leave sooner or go further from Room 1." : "As gentle as the suggested plan; the AI preferred the other.";
}
