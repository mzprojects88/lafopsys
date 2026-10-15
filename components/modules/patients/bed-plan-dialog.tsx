"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { patientsStore, usePatientsData } from "@/lib/hooks/use-patients-collection";
import { bedNightsStore } from "@/lib/hooks/use-bed-nights-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { useBedReservations } from "@/lib/hooks/use-bed-reservations";
import { useRole } from "@/context/role-provider";
import { canSeeClinicalDetail } from "@/lib/rbac/roles";
import { FloorPlanCanvas } from "@/components/modules/house-ops/floor-plan/floor-plan-canvas";
import { buildBedViews } from "@/components/modules/house-ops/floor-plan/bed-view";
import { bedLabel } from "@/lib/utils/beds";
import { isValidArrangement, type PlanBed, type PlanPerson } from "@/lib/utils/bed-plan";
import type { Sex } from "@/lib/utils/bed-rules";
import { todayIso } from "@/lib/utils/date";
import { plainError } from "@/lib/utils/plain-error";

interface PlanMove {
  stayId: string | null;
  /** "new:<id>" for one of tonight's arrivals. */
  arrivalKey?: string | null;
  fromUnitId: string | null;
  toUnitId: string;
  reason: string;
}
interface PlanAnswer {
  ok: boolean;
  error?: string;
  message?: string;
  ai?: boolean;
  chosen?: number;
  explanation?: string;
  letters?: Record<string, string>;
  plans?: { moves: PlanMove[]; whyNot?: string | null }[];
  layout?: { people: PlanPerson[]; beds: PlanBed[] };
  /** Arrivals no bed within the rules was found for tonight, in NCH's priority order. */
  waiting?: string[];
}

/** A family on NCH's list who needs a bed tonight (House Today). */
export interface PlanArrival {
  key: string;
  name: string;
  sex: Sex;
  familyId?: string;
  patientId: string | null;
  sheetPersonId: string | null;
}

const moveId = (m: PlanMove) => m.stayId ?? m.arrivalKey ?? "newcomer";
const noop = () => undefined;
const noDraft = () => undefined;

/**
 * "Suggest bed plan" (bed rules, 0071; polished 2026-10-15): the fewest moves that bring the house
 * within the rules -- placing tonight's arrivals too -- chosen and explained by the AI
 * (app/api/patients/bed-plan). The social worker sees it on the floor plan, can leave a move out
 * (the rest is checked against the rules at once), and approves: the moves happen together
 * (ops.apply_bed_plan, checked again there) and each arrival's bed is held for their check-in.
 */
export function BedPlanDialog({
  newcomer,
  arrivals = [],
  onClose,
  onApplied,
}: {
  newcomer?: { sex: Sex; familyId?: string; name: string };
  arrivals?: PlanArrival[];
  onClose: () => void;
  /** After the moves: the bed kept for the family arriving, if any. */
  onApplied?: (newcomerUnitId: string | null) => void;
}) {
  const { stays, patients, carers } = usePatientsData();
  const { units, rooms, bedPositions, labels } = useHouseLayout();
  const { reservations, reserve } = useBedReservations();
  const { roles } = useRole();
  const [answer, setAnswer] = React.useState<PlanAnswer | null>(null);
  const [pick, setPick] = React.useState(0);
  // Moves left out by the social worker, per plan ("plan:move").
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());
  const [applying, setApplying] = React.useState(false);

  // Asked again only when who is arriving changes, not on every render.
  const arrivingSex = newcomer?.sex;
  const arrivingFamily = newcomer?.familyId;
  const arrivalsKey = JSON.stringify(arrivals.map((a) => [a.key, a.sex, a.familyId ?? null]));
  React.useEffect(() => {
    let cancelled = false;
    const list = JSON.parse(arrivalsKey) as [string, Sex, string | null][];
    fetch("/api/patients/bed-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        arrivingSex
          ? { newcomer: { sex: arrivingSex, familyId: arrivingFamily } }
          : { arrivals: list.map(([key, sex, familyId]) => ({ key, sex, familyId: familyId ?? undefined })) }
      ),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({ ok: false, error: "The plan could not be read." }))) as PlanAnswer;
        if (cancelled) return;
        setAnswer(res.ok ? body : { ok: false, error: body.error ?? "Couldn't make a plan." });
        setPick(body.chosen ?? 0);
      })
      .catch(() => !cancelled && setAnswer({ ok: false, error: "Couldn't reach the planner." }));
    return () => {
      cancelled = true;
    };
  }, [arrivingSex, arrivingFamily, arrivalsKey]);

  const plan = answer?.plans?.[pick];
  const isOn = (m: PlanMove) => !skipped.has(`${pick}:${moveId(m)}`);
  const chosenMoves = plan?.moves.filter(isOn) ?? [];
  const familyMoves = chosenMoves.filter((m) => m.stayId);
  const arrivalMoves = chosenMoves.filter((m) => m.arrivalKey);
  const newcomerMove = plan?.moves.find((m) => !m.stayId && !m.arrivalKey);

  // Leaving a move out: the rest must still keep every rule, on the end state, as the database judges it.
  const stillValid = React.useMemo(() => {
    if (!plan || !answer?.layout) return true;
    const left = new Set(plan.moves.filter((m) => !isOn(m)).map(moveId));
    const people = answer.layout.people.filter((p) => !(p.key.startsWith("new:") && left.has(p.key)));
    const unitOf = new Map(people.map((p) => [p.key, p.unitId]));
    for (const m of plan.moves) if (isOn(m)) unitOf.set(m.stayId ?? m.arrivalKey ?? "__newcomer__", m.toUnitId);
    return isValidArrangement(people, answer.layout.beds, unitOf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isOn reads `skipped` and `pick`, both listed.
  }, [plan, answer, skipped, pick]);

  const label = (unitId: string | null) => {
    const unit = units.find((u) => u.id === unitId);
    return unit ? bedLabel(unit, rooms) : "—";
  };
  const whose = (stayId: string) => {
    const stay = stays.find((s) => s.id === stayId);
    const patient = stay ? patients.find((p) => p.id === stay.patientId) : undefined;
    return patient ? `${patient.firstName} ${patient.lastName}` : "A family";
  };
  const arrivalName = (key: string) => arrivals.find((a) => a.key === key)?.name ?? "A family arriving";
  // The AI wrote "Family A"; the names never left the app, so they go back in here.
  const explanation = (answer?.explanation ?? "").replace(/Family ([A-Z])\b/g, (text, letter: string) => {
    const id = answer?.letters?.[letter];
    if (!id) return text;
    if (id === "new") return newcomer?.name ? `${newcomer.name}'s family` : "the family arriving";
    return id.startsWith("new:") ? `${arrivalName(id)}'s family` : `${whose(id)}'s family`;
  });

  // The picture: every bed a chosen move leaves or takes, on the house's floor plan.
  const bedViews = React.useMemo(
    () => buildBedViews({ units, rooms, bedPositions, stays, patients, carers, draftFor: noDraft, holds: reservations }).filter((b) => b.x !== null && b.y !== null),
    [units, rooms, bedPositions, stays, patients, carers, reservations]
  );
  const marks = new Map<string, "from" | "to">();
  for (const m of chosenMoves) {
    if (m.fromUnitId) marks.set(m.fromUnitId, "from");
  }
  for (const m of chosenMoves) marks.set(m.toUnitId, "to");

  async function apply() {
    if (!plan) return;
    setApplying(true);
    if (familyMoves.length) {
      const { error } = await createClient()
        .schema("ops")
        .rpc("apply_bed_plan", {
          p_moves: familyMoves.map((m) => ({ stay_id: m.stayId, unit_id: m.toUnitId, reason: m.reason })),
          p_summary: explanation || null,
        });
      if (error) {
        setApplying(false);
        toast.error(`Couldn't apply the plan: ${plainError(error.message)}`);
        return;
      }
    }
    // Each arrival's bed is held until they are checked in (0065). A temporary mattress can't be
    // held (0092): those are checked in straight onto it.
    const notHeld: string[] = [];
    for (const m of arrivalMoves) {
      const a = arrivals.find((x) => x.key === m.arrivalKey);
      if (!a) continue;
      if (units.find((u) => u.id === m.toUnitId)?.temporary) {
        notHeld.push(`${a.name} (${label(m.toUnitId)}: temporary bed, check in directly)`);
        continue;
      }
      const r = await reserve({ unitId: m.toUnitId, patientId: a.patientId, sheetPersonId: a.sheetPersonId, reservedFor: a.name, expectedOn: todayIso(), carerSex: a.sex, note: "Bed plan" });
      if (!r.ok) notHeld.push(`${a.name} (${plainError(r.error)})`);
    }
    setApplying(false);
    await Promise.all([patientsStore.refetch(), bedNightsStore.refetch()]);
    const parts = [
      familyMoves.length ? `${familyMoves.length} ${familyMoves.length === 1 ? "family moved" : "families moved"}` : null,
      arrivalMoves.length - notHeld.length > 0 ? `${arrivalMoves.length - notHeld.length} bed${arrivalMoves.length - notHeld.length === 1 ? "" : "s"} held for arrivals` : null,
    ].filter(Boolean);
    if (parts.length) toast.success(`${parts.join(", ")} for tonight.`);
    if (notHeld.length) toast.warning(`Not held: ${notHeld.join("; ")}`);
    onApplied?.(newcomerMove?.toUnitId ?? null);
    onClose();
  }

  const waitingNote = answer?.waiting?.length ? (
    <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-theme-sm text-warning-foreground dark:text-warning">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        No bed within the rules tonight for {answer.waiting.map(arrivalName).join(", ")}. Check them in one at a time once a bed frees up; an admin can allow an exception, with a reason.
      </span>
    </p>
  ) : null;

  const toggle = (m: PlanMove) =>
    setSkipped((prev) => {
      const next = new Set(prev);
      const k = `${pick}:${moveId(m)}`;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const row = (m: PlanMove, name: string, text: React.ReactNode) => (
    <li key={moveId(m)} className="flex items-start gap-2.5 px-3 py-2 text-theme-sm">
      {newcomer ? null : <Checkbox className="mt-0.5" checked={isOn(m)} onCheckedChange={() => toggle(m)} aria-label={`Approve: ${name}`} />}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={isOn(m) ? "font-medium text-foreground" : "font-medium text-muted-foreground line-through"}>{name}</span>
        <span className="flex flex-wrap items-center gap-1 text-theme-xs text-muted-foreground">{text}</span>
      </span>
    </li>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !applying && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{newcomer ? `A bed for ${newcomer.name}` : arrivals.length ? `Tonight's beds: ${arrivals.length} arriving` : "Suggested bed plan"}</DialogTitle>
          <DialogDescription>
            The fewest moves that keep the rooms single-sex and fill Room 1 first. Tick off a move you don&apos;t want; the rest is checked against the rules at once. Families move together, from tonight.
          </DialogDescription>
        </DialogHeader>

        {!answer ? (
          <p className="flex items-center gap-2 text-theme-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Working out the moves…
          </p>
        ) : !answer.ok ? (
          <p className="text-theme-sm text-destructive">{answer.error}</p>
        ) : !plan ? (
          <div className="flex flex-col gap-3">
            <p className="text-theme-sm text-muted-foreground">{answer.message}</p>
            {waitingNote}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {waitingNote}
            {explanation && pick === answer.chosen ? (
              <p className="rounded-xl bg-muted/60 p-3 text-theme-sm text-foreground">
                {answer.ai ? <Sparkles className="mr-1.5 inline size-3.5 text-muted-foreground" aria-label="Chosen by AI" /> : null}
                {explanation}
              </p>
            ) : plan.whyNot ? (
              <p className="rounded-xl bg-muted/60 p-3 text-theme-sm text-foreground">Why it isn&apos;t the suggestion: {plan.whyNot}</p>
            ) : null}
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {plan.moves
                .filter((m) => m.stayId)
                .map((m) =>
                  row(m, whose(m.stayId!), (
                    <>
                      {label(m.fromUnitId)} <ArrowRight className="size-3" /> <b className="text-foreground">{label(m.toUnitId)}</b> · {m.reason}
                    </>
                  ))
                )}
              {plan.moves
                .filter((m) => m.arrivalKey)
                .map((m) =>
                  row(m, arrivalName(m.arrivalKey!), (
                    <>
                      Arriving · takes <b className="text-foreground">{label(m.toUnitId)}</b> (held until check-in)
                    </>
                  ))
                )}
              {newcomerMove
                ? row(newcomerMove, newcomer?.name ?? "The family arriving", (
                    <>
                      Takes <b className="text-foreground">{label(newcomerMove.toUnitId)}</b>
                    </>
                  ))
                : null}
            </ul>
            {!stillValid ? (
              <p className="flex items-start gap-2 rounded-xl bg-warning/10 p-3 text-theme-sm text-warning-foreground dark:text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> Without the move you ticked off, a room breaks the bed rules. Tick it again, or choose another plan.
              </p>
            ) : null}
            {bedViews.length ? (
              <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border">
                <FloorPlanCanvas
                  rooms={rooms}
                  beds={bedViews}
                  labels={labels}
                  dirtyLabelIds={new Set()}
                  selection={null}
                  editing={false}
                  canSeeClinical={canSeeClinicalDetail(roles)}
                  onSelect={noop}
                  onMove={noop}
                  onDrop={noop}
                  onResize={noop}
                  onRotate={noop}
                  onRetireRequest={noop}
                  onMoveLabel={noop}
                  onRotateLabel={noop}
                  onDeleteLabel={noop}
                  previews={false}
                  marks={marks}
                />
                <p className="px-3 py-1.5 text-theme-xs text-muted-foreground">Green: the bed a family takes. Red dashes: the bed they leave.</p>
              </div>
            ) : null}
            {(answer.plans?.length ?? 0) > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5 text-theme-xs text-muted-foreground">
                Other plans:
                {answer.plans!.map((_, i) => (
                  <Button key={i} type="button" size="sm" variant={i === pick ? "default" : "outline"} className="h-7 rounded-full px-3 text-xs" onClick={() => setPick(i)}>
                    {i === answer.chosen ? `Plan ${i + 1} (suggested)` : `Plan ${i + 1}`}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={applying}>
            {plan ? "Not now" : "Close"}
          </Button>
          {plan ? (
            <Button onClick={() => void apply()} disabled={applying || !stillValid || chosenMoves.length === 0}>
              {applying
                ? "Applying…"
                : newcomer && !familyMoves.length
                  ? "Use this bed"
                  : `Approve ${chosenMoves.length} ${chosenMoves.length === 1 ? "move" : "moves"}`}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
