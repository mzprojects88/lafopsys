"use client";

import * as React from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { patientsStore, usePatientsData } from "@/lib/hooks/use-patients-collection";
import { bedNightsStore } from "@/lib/hooks/use-bed-nights-collection";
import { useHouseLayout } from "@/lib/hooks/use-house-layout-collection";
import { bedLabel } from "@/lib/utils/beds";
import type { Sex } from "@/lib/utils/bed-rules";

interface PlanMove {
  stayId: string | null;
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
  plans?: { moves: PlanMove[] }[];
}

/**
 * "Suggest bed plan" (bed rules, 0071): the fewest moves that bring the
 * house within the rules -- and, with `newcomer`, a bed for the family
 * arriving -- chosen and explained by the AI (app/api/patients/bed-plan).
 * The social worker applies it; the moves happen together
 * (ops.apply_bed_plan, checked again there) and become tonight's beds.
 */
export function BedPlanDialog({
  newcomer,
  onClose,
  onApplied,
}: {
  newcomer?: { sex: Sex; familyId?: string; name: string };
  onClose: () => void;
  /** After the moves: the bed kept for the family arriving, if any. */
  onApplied?: (newcomerUnitId: string | null) => void;
}) {
  const { stays, patients } = usePatientsData();
  const { units, rooms } = useHouseLayout();
  const [answer, setAnswer] = React.useState<PlanAnswer | null>(null);
  const [pick, setPick] = React.useState(0);
  const [applying, setApplying] = React.useState(false);

  // Asked again only when who is arriving changes, not on every render.
  const arrivingSex = newcomer?.sex;
  const arrivingFamily = newcomer?.familyId;
  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/patients/bed-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(arrivingSex ? { newcomer: { sex: arrivingSex, familyId: arrivingFamily } } : {}),
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
  }, [arrivingSex, arrivingFamily]);

  const plan = answer?.plans?.[pick];
  const familyMoves = plan?.moves.filter((m) => m.stayId) ?? [];
  const arriving = plan?.moves.find((m) => !m.stayId);
  const label = (unitId: string | null) => {
    const unit = units.find((u) => u.id === unitId);
    return unit ? bedLabel(unit, rooms) : "—";
  };
  const whose = (stayId: string) => {
    const stay = stays.find((s) => s.id === stayId);
    const patient = stay ? patients.find((p) => p.id === stay.patientId) : undefined;
    return patient ? `${patient.firstName} ${patient.lastName}` : "A family";
  };
  // The AI wrote "Family A"; the names never left the app, so they go back in here.
  const explanation = (answer?.explanation ?? "").replace(/Family ([A-Z])\b/g, (text, letter: string) => {
    const id = answer?.letters?.[letter];
    if (!id) return text;
    return id === "new" ? (newcomer?.name ? `${newcomer.name}'s family` : "the family arriving") : `${whose(id)}'s family`;
  });

  async function apply() {
    if (!plan) return;
    if (!familyMoves.length) {
      onApplied?.(arriving?.toUnitId ?? null);
      onClose();
      return;
    }
    setApplying(true);
    const { error } = await createClient()
      .schema("ops")
      .rpc("apply_bed_plan", {
        p_moves: familyMoves.map((m) => ({ stay_id: m.stayId, unit_id: m.toUnitId, reason: m.reason })),
        p_summary: explanation || null,
      });
    setApplying(false);
    if (error) {
      toast.error(`Couldn't apply the plan: ${error.message}`);
      return;
    }
    await Promise.all([patientsStore.refetch(), bedNightsStore.refetch()]);
    toast.success(`${familyMoves.length} ${familyMoves.length === 1 ? "family moved" : "families moved"} for tonight.`);
    onApplied?.(arriving?.toUnitId ?? null);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !applying && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{newcomer ? `A bed for ${newcomer.name}` : "Suggested bed plan"}</DialogTitle>
          <DialogDescription>
            The fewest moves that keep the rooms single-sex and fill Room 1 first. Families move together, from tonight; nobody is moved at night.
          </DialogDescription>
        </DialogHeader>

        {!answer ? (
          <p className="flex items-center gap-2 text-theme-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Working out the moves…
          </p>
        ) : !answer.ok ? (
          <p className="text-theme-sm text-destructive">{answer.error}</p>
        ) : !plan ? (
          <p className="text-theme-sm text-muted-foreground">{answer.message}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {explanation ? (
              <p className="rounded-xl bg-muted/60 p-3 text-theme-sm text-foreground">
                {answer.ai ? <Sparkles className="mr-1.5 inline size-3.5 text-muted-foreground" aria-label="Chosen by AI" /> : null}
                {explanation}
              </p>
            ) : null}
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {familyMoves.map((m) => (
                <li key={m.stayId} className="flex flex-col gap-0.5 px-3 py-2 text-theme-sm">
                  <span className="font-medium text-foreground">{whose(m.stayId!)}</span>
                  <span className="flex flex-wrap items-center gap-1 text-theme-xs text-muted-foreground">
                    {label(m.fromUnitId)} <ArrowRight className="size-3" /> <b className="text-foreground">{label(m.toUnitId)}</b> · {m.reason}
                  </span>
                </li>
              ))}
              {arriving ? (
                <li className="flex flex-col gap-0.5 px-3 py-2 text-theme-sm">
                  <span className="font-medium text-foreground">{newcomer?.name ?? "The family arriving"}</span>
                  <span className="text-theme-xs text-muted-foreground">
                    Takes <b className="text-foreground">{label(arriving.toUnitId)}</b>
                  </span>
                </li>
              ) : null}
            </ul>
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
            <Button onClick={() => void apply()} disabled={applying}>
              {applying ? "Moving…" : familyMoves.length ? `Move ${familyMoves.length} ${familyMoves.length === 1 ? "family" : "families"}` : "Use this bed"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
