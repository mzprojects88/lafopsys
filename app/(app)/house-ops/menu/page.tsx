"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, Send, ShieldCheck, Sparkles, X } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { MenuWeekGrid } from "@/components/modules/house-ops/menu-week-grid";
import { MealEditorDialog, type StockItem } from "@/components/modules/house-ops/meal-editor-dialog";
import { createClient } from "@/lib/supabase/client";
import { useMenuWeek } from "@/lib/hooks/use-menu-week";
import { useRole } from "@/context/role-provider";
import { mondayOf, weekDates, type MenuWeekFacts } from "@/lib/ai/menu-week";
import { weekStatus, type MenuMeal } from "@/lib/utils/menu-week-ui";
import { formatDate, todayIso } from "@/lib/utils/date";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import { cn } from "@/lib/utils";

const PLANNERS = ["admin", "inventory_lead", "chef", "social_worker", "nutritionist"];
const REVIEWERS = ["admin", "inventory_lead", "nutritionist"];
const WEEK_LABEL: Record<string, { label: string; tone: keyof typeof STATUS_TONE_CLASSES }> = {
  empty: { label: "Nothing planned", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  mixed: { label: "Partly approved", tone: "neutral" },
  pending: { label: "Waiting for the Nutritionist", tone: "warning" },
  approved: { label: "Approved", tone: "positive" },
  rejected: { label: "Sent back", tone: "negative" },
};
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const label = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * House Operations › Weekly Menu (0120 / Inventory 0068): the same week LAF Inventory's kitchen
 * cooks from. The Social Worker edits and sends it for review; the Nutritionist / Dietician
 * approves it, or builds a week by hand against the stock on hand.
 */
export default function WeeklyMenuPage() {
  const { roles } = useRole();
  const canPlan = roles.some((r) => PLANNERS.includes(r));
  const canReview = roles.some((r) => REVIEWERS.includes(r));
  const today = todayIso();
  const [weekStart, setWeekStart] = React.useState(() => mondayOf(today));
  const { meals, people, error, loading, saveMeals, setStatus, suggest, check } = useMenuWeek(weekStart);
  // Planners also get the week's facts: the stock on hand (for the chips and the editor), dishes and headcounts.
  const [facts, setFacts] = React.useState<MenuWeekFacts | null>(null);
  React.useEffect(() => {
    if (!canPlan && !canReview) return;
    let live = true;
    void createClient()
      .schema("inventory")
      .rpc("menu_week_facts", { p_week_start: weekStart })
      .then(({ data }) => {
        if (live && data) setFacts(data as MenuWeekFacts);
      });
    return () => {
      live = false;
    };
  }, [weekStart, canPlan, canReview, meals]);

  const [editing, setEditing] = React.useState<{ date: string; mealType: string; meal: MenuMeal | null } | null>(null);
  const [busy, setBusy] = React.useState<"suggest" | "check" | "status" | null>(null);
  const [summary, setSummary] = React.useState<{ text: string; shopping: { name: string; note: string }[] } | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [reason, setReason] = React.useState("");

  // Breakfast, lunch and dinner only, as LAF Inventory shows them (snacks are not planned).
  const types = (facts?.meal_types ?? ["breakfast", "lunch", "dinner"]).filter((t) => ["breakfast", "lunch", "dinner"].includes(t)).map((t) => ({ value: t, label: label(t) }));
  const stock: StockItem[] = React.useMemo(() => (facts?.stock ?? []).map((s) => ({ id: s.item_id, name: s.name, uom: s.uom, onHand: s.qty })), [facts]);
  const onHand = React.useMemo(() => new Map(stock.map((s) => [s.id, s.onHand])), [stock]);
  const itemName = (id: string) => stock.find((s) => s.id === id)?.name ?? "item";
  const dishes = React.useMemo(() => (facts?.dishes ?? []).map((d) => ({ id: d.recipe_id, name: d.name, ingredients: d.ingredients })), [facts]);
  const status = weekStatus(meals ?? []);
  const canEditWeek = canPlan && weekStart >= mondayOf(today);

  if (!canPlan && !canReview && !roles.length) return null;

  async function act(kind: "suggest" | "check" | "status", run: () => Promise<{ ok: boolean; error?: string }>, done?: string) {
    setBusy(kind);
    const r = await run();
    setBusy(null);
    if (!r.ok) return void toast.error(r.error ?? "Something went wrong.");
    if (done) toast.success(done);
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader title="Weekly Menu" description="The week's meals from the food on hand, checked against the doctors' food instructions. Approved by the Nutritionist / Dietician; cooked and recorded in LAF Inventory." />

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3">
        <Button type="button" variant="outline" size="icon" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Week of {formatDate(weekStart)}</p>
          <p className="text-xs text-muted-foreground">to {formatDate(weekDates(weekStart)[6]!)}</p>
        </div>
        <Badge className={cn("border-none", STATUS_TONE_CLASSES[WEEK_LABEL[status]!.tone])}>{WEEK_LABEL[status]!.label}</Badge>
        <Button type="button" variant="outline" size="icon" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight className="size-4" />
        </Button>
      </div>

      {error ? <p className="text-theme-sm text-destructive">{error}</p> : null}

      {canEditWeek || canReview ? (
        <div className="flex flex-wrap gap-2">
          {canEditWeek ? (
            <Button type="button" disabled={busy !== null} className="gap-1.5" onClick={() => act("suggest", async () => { const r = await suggest(); if (r.ok) setSummary({ text: r.value.summary, shopping: r.value.shopping }); return r; })}>
              <Sparkles className="size-4" />
              {busy === "suggest" ? "Planning the week…" : meals?.length ? "Suggest again" : "Suggest this week"}
            </Button>
          ) : null}
          {meals?.length ? (
            <Button type="button" variant="outline" disabled={busy !== null} className="gap-1.5" onClick={() => act("check", () => check(), "Checked against the food instructions")}>
              <ShieldCheck className="size-4" />
              {busy === "check" ? "Checking…" : "Check against instructions"}
            </Button>
          ) : null}
          {canEditWeek && meals?.length && (status === "draft" || status === "rejected" || status === "mixed") ? (
            <Button type="button" variant="outline" disabled={busy !== null} className="gap-1.5" onClick={() => act("status", () => setStatus("pending_nutritionist"), "Sent to the Nutritionist")}>
              <Send className="size-4" /> Send for review
            </Button>
          ) : null}
          {canReview && meals?.length && status !== "approved" ? (
            <>
              <Button type="button" variant="outline" disabled={busy !== null} className="gap-1.5" onClick={() => act("status", () => setStatus("approved"), "Week approved")}>
                <Check className="size-4" /> Approve the week
              </Button>
              <Button type="button" variant="ghost" disabled={busy !== null} className="gap-1.5 text-destructive" onClick={() => setRejecting(true)}>
                <X className="size-4" /> Send back
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-theme-sm">
          <p className="font-medium">The AI&apos;s suggestion</p>
          <p className="text-muted-foreground">{summary.text}</p>
          {summary.shopping.length ? <p className="pt-2 text-theme-xs text-muted-foreground">To buy: {summary.shopping.map((s) => `${s.name}${s.note ? ` (${s.note})` : ""}`).join(", ")}</p> : null}
        </div>
      ) : null}
      {meals?.some((m) => m.reviewNote) ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-theme-sm">
          <p className="font-medium">Sent back by the Nutritionist</p>
          <p className="text-muted-foreground">{meals.find((m) => m.reviewNote)?.reviewNote}</p>
        </div>
      ) : null}
      {Object.keys(people).length ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-theme-sm">
          <p className="font-medium">Food instructions this week</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
            {Object.entries(people).map(([l, p]) => (
              <li key={l}>
                <span className="font-medium text-foreground">{p.name}</span>
                {p.applies_to === "carer" ? " (carer)" : ""}: {p.instruction}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {facts?.dietary_rules ? <p className="text-theme-xs text-muted-foreground">Dietary rules (LAF Inventory › Settings › Dishes): {facts.dietary_rules}</p> : null}

      {loading && !meals ? (
        <p className="text-theme-sm text-muted-foreground">Loading the week…</p>
      ) : !meals?.length && !canEditWeek ? (
        <EmptyState title="Nothing planned for this week" description="The kitchen or the Social Worker plans the week in LAF Inventory › Menu or here." />
      ) : (
        <MenuWeekGrid weekStart={weekStart} mealTypes={types} meals={meals ?? []} onHand={onHand} itemName={itemName} canEdit={canEditWeek} onEdit={(date, mealType, meal) => (canEditWeek || meal) && setEditing({ date, mealType, meal })} />
      )}

      {editing ? (
        <MealEditorDialog
          key={editing.meal?.id ?? `${editing.date}|${editing.mealType}`}
          open
          date={editing.date}
          mealType={editing.mealType}
          mealLabel={label(editing.mealType)}
          meal={editing.meal}
          stock={stock}
          dishes={dishes}
          people={people}
          labels={Object.keys(people)}
          defaultServings={facts?.headcount[editing.mealType] ?? 25}
          onSave={async (meal) => {
            if (!canEditWeek) return { ok: false, error: "This week can't be changed." };
            const r = await saveMeals([meal]);
            return r.ok ? { ok: true } : r;
          }}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}

      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send the week back</DialogTitle>
            <DialogDescription>The kitchen and the Social Worker see your note and plan again.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} placeholder="What to change" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRejecting(false)}>Cancel</Button>
            <Button type="button" disabled={reason.trim().length < 3 || busy !== null} onClick={() => act("status", () => setStatus("rejected", reason.trim()), "Sent back").then(() => { setRejecting(false); setReason(""); })}>
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
