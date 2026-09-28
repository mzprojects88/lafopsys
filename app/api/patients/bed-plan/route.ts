import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { chooseBedPlan, type BedPlanPerson } from "@/lib/ai/openai";
import { openaiConfigured } from "@/lib/ai/env";
import { NEWCOMER, findBedPlans, type PlanBed, type PlanPerson } from "@/lib/utils/bed-plan";
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

  const body = (await request.json().catch(() => ({}))) as { newcomer?: { sex?: unknown; familyId?: unknown } };
  const newcomerSex = body.newcomer?.sex === "F" || body.newcomer?.sex === "M" ? (body.newcomer.sex as Sex) : null;
  if (body.newcomer && !newcomerSex) return NextResponse.json({ ok: false, error: "Say whether the arriving carer is a woman or a man." }, { status: 400 });

  const ops = supabase.schema("ops");
  const [units, rooms, positions, stays, holds] = await Promise.all([
    ops.from("units").select("id, code, room_id, active, status, capacity"),
    ops.from("rooms").select("id, name, sort_order"),
    ops.from("bed_positions").select("id, unit_id"),
    ops.from("stays").select("id, patient_id, bed_position_id, carer_id, check_in_at, expected_checkout_at").in("status", ["in_house", "overdue"]),
    ops.from("bed_reservations").select("id, unit_id, patient_id, carer_sex").eq("status", "active"),
  ]);
  const failed = [units, rooms, positions, stays, holds].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ ok: false, error: failed.error.message }, { status: 500 });

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
      nightsHere: daysBetween(s.check_in_at, today),
      leavesIn: s.expected_checkout_at ? daysBetween(today, s.expected_checkout_at) : undefined,
    };
  });
  for (const h of holds.data ?? []) people.push({ key: `hold:${h.id}`, sex: h.carer_sex ?? undefined, familyId: undefined, unitId: h.unit_id, fixed: true });
  if (newcomerSex) people.push({ key: NEWCOMER, sex: newcomerSex, familyId: typeof body.newcomer?.familyId === "string" ? body.newcomer.familyId : undefined, unitId: null });

  const plans = findBedPlans(people, beds);
  if (!plans.length) {
    return NextResponse.json({
      ok: true,
      plans: [],
      message: newcomerSex
        ? "No arrangement within the rules has a bed for them. An admin can place them outside the rules, with a reason."
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
    plans: plans.map((p) => ({
      moves: p.moves.map((m) => ({
        stayId: m.key === NEWCOMER ? null : m.key,
        fromUnitId: m.from,
        toUnitId: m.to,
        reason: reasons[m.key === NEWCOMER ? "new" : m.key] ?? (m.key === NEWCOMER ? "Bed for the family arriving" : `To ${bedLabel(m.to)}: keeps the bed rules`),
      })),
    })),
  });
}
