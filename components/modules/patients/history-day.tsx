"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CopyPlus, FileDown, Lock, Plus, Trash2, UserPlus } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { history, useHistoryDay, type HistoryResult } from "@/lib/hooks/use-history";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { addDays } from "@/lib/utils/dtr";
import { formatDate } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";
import { plainError } from "@/lib/utils/plain-error";
import {
  DIRECTION_LABEL,
  MEALS,
  copyPlan,
  fillPlan,
  needsNote,
  type DayBed,
  type DayRow,
  type Direction,
  type HistoryDayData,
  type Meal,
  type PlannedNight,
  type SheetPerson,
} from "@/lib/utils/history";
import type { HistoryMode } from "./history-ledger";

const MEAL_LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const DIRECTIONS: Direction[] = ["to_hospital", "from_hospital"];
const ACTION_LABEL: Record<string, string> = {
  night_added: "added the night",
  night_changed: "changed the night",
  night_removed: "removed the night",
  meals_added: "added meals",
  meals_removed: "removed meals",
  ride_added: "added a ride",
  ride_removed: "removed a ride",
  day_completed: "marked the day complete",
  day_reopened: "reopened the day",
};

/** One past day in a side panel: its children, and every change to them (0167). */
export function HistoryDay({ day, mode, onClose, onChanged, onStep }: { day: string | null; mode: HistoryMode; onClose: () => void; onChanged: () => void; onStep: (n: number) => void }) {
  return (
    <Sheet open={!!day} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        {day ? <DayBody key={day} day={day} mode={mode} onChanged={onChanged} onStep={onStep} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function DayBody({ day, mode, onChanged, onStep }: { day: string; mode: HistoryMode; onChanged: () => void; onStep: (n: number) => void }) {
  const { data, error, refetch } = useHistoryDay(day);
  const [note, setNote] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [plan, setPlan] = React.useState<{ title: string; nights: PlannedNight[]; unmatched: SheetPerson[] } | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [completing, setCompleting] = React.useState(false);
  const [removing, setRemoving] = React.useState<string[] | null>(null);
  const noteRef = React.useRef<HTMLInputElement>(null);

  const noteNeeded = !!data && needsNote(day, data.today, data.noteDays);
  const canNights = !!data && mode === "patients" && data.canNights && data.inWindow;
  const canRides = !!data && data.canRides && data.inWindow;

  /** Every change goes through here: the note first when the day needs one, then the database, then a fresh read. */
  async function run(action: () => Promise<HistoryResult | HistoryResult[]>, done?: string): Promise<boolean> {
    if (noteNeeded && !note.trim()) {
      toast.error("Add a note first: why this day is being entered now.");
      noteRef.current?.focus();
      return false;
    }
    setBusy(true);
    const out = await action();
    setBusy(false);
    const failed = (Array.isArray(out) ? out : [out]).filter((r): r is Extract<HistoryResult, { ok: false }> => !r.ok);
    if (failed.length) toast.error(failed.length > 1 ? `${failed.length} changes were not saved: ${plainError(failed[0]!.error)}` : plainError(failed[0]!.error));
    else if (done) toast.success(done);
    refetch();
    onChanged();
    return failed.length === 0;
  }

  if (error) return <p className="p-6 text-theme-sm text-destructive">{plainError(error)}</p>;
  if (!data) return <p className="p-6 text-theme-sm text-muted-foreground">Loading the day…</p>;

  const rows = data.rows;
  const stayed = rows.filter((r) => r.stayed);
  const ids = [...selected].filter((id) => rows.some((r) => r.patientId === id));
  const fill = fillPlan(data);
  const sleptOnSheet = data.sheet.filter((p) => p.slept).length;

  const toggleAll = () => setSelected(ids.length === rows.length ? new Set() : new Set(rows.map((r) => r.patientId)));

  async function savePlan(nights: PlannedNight[]) {
    const results: HistoryResult[] = [];
    for (const n of nights) {
      if (!n.mealsOnly) {
        if (!n.unitId) continue;
        const r = await history.saveNight(day, n.patientId, n.unitId, { carerId: n.carerId, people: n.people, note });
        results.push(r);
        if (!r.ok) continue;
      }
      if (n.meals.length) results.push(await history.setMeals(day, [n.patientId], n.meals, true, note));
    }
    return results;
  }

  async function copyDayBefore() {
    const before = await history.readDay(addDays(day, -1));
    if (!before.ok) return void toast.error(plainError(before.error));
    const nights = copyPlan(before.data as HistoryDayData, data!);
    if (nights.length === 0) return void toast.info("Everyone of the night before is already here.");
    setPlan({ title: "Copy the day before", nights, unmatched: [] });
  }

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <SheetHeader className="p-0">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Day before" onClick={() => onStep(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <SheetTitle className="text-lg">{formatDate(day, "EEEE, MMMM d, yyyy")}</SheetTitle>
          <Button variant="outline" size="icon-sm" aria-label="Day after" disabled={addDays(day, 1) >= data.today} onClick={() => onStep(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <SheetDescription>
          {mode === "patients"
            ? `${stayed.length} children in the app · ${sleptOnSheet} on the House Sheet`
            : `${rows.filter((r) => Object.keys(r.rides).length).length} children rode`}
          {data.completed ? ` · complete${data.completed.by ? `, by ${data.completed.by}` : ""} ${formatDate(data.completed.at, "MMM d, h:mm a")}` : ""}
        </SheetDescription>
      </SheetHeader>

      {!data.inWindow ? (
        <Notice tone="muted">
          <Lock className="size-4" /> Past days can be entered up to {data.backDays} days back. Ask an admin for an older day.
        </Notice>
      ) : null}
      {data.cafLocked ? <Notice tone="warning">The NCH bill for this month is final: NCH-billed children&apos;s nights can&apos;t change, and the day can&apos;t be completed. Reopen the bill first.</Notice> : null}
      {mode === "patients" && !data.canNights ? <Notice tone="muted">You can view this day. Entering nights and meals needs Patients edit.</Notice> : null}

      {canNights || canRides ? (
        <label className="flex flex-col gap-1 text-theme-sm">
          <span className="font-medium">
            Note for these changes {noteNeeded ? <span className="text-destructive">(needed: more than {data.noteDays} days back)</span> : <span className="text-muted-foreground">(optional)</span>}
          </span>
          <Input ref={noteRef} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. From the House Sheet and the meal list" maxLength={300} />
        </label>
      ) : null}

      {canNights ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || fill.nights.length + fill.unmatched.length === 0} onClick={() => setPlan({ title: "Fill from the sheet", ...fill })}>
            <FileDown className="size-4" /> Fill from the sheet{fill.nights.length ? ` (${fill.nights.length})` : ""}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void copyDayBefore()}>
            <CopyPlus className="size-4" /> Copy the day before
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setAdding(true)}>
            <UserPlus className="size-4" /> Add a child
          </Button>
          {data.completed ? (
            <Button variant="outline" disabled={busy || data.cafLocked} onClick={() => void run(() => history.completeDay(day, false, { note }), "The day is open again.")}>
              Reopen the day
            </Button>
          ) : (
            <Button disabled={busy || data.cafLocked} onClick={() => setCompleting(true)}>
              <Check className="size-4" /> Mark day complete
            </Button>
          )}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-center text-theme-sm text-muted-foreground">
          Nobody is recorded in the app for this day{mode === "patients" && data.sheet.length ? `; the sheets list ${data.sheet.length}. Use Fill from the sheet.` : "."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-theme-sm">
              <Checkbox checked={ids.length > 0 && ids.length === rows.length} onCheckedChange={toggleAll} aria-label="Select every child" />
              {ids.length ? `${ids.length} selected` : "Select to change several at once"}
            </label>
            {ids.length ? (
              <BulkActions
                mode={mode}
                busy={busy}
                canNights={canNights}
                canRides={canRides}
                onMeals={(meals, on) => void run(() => history.setMeals(day, ids, meals, on, note), "Meals saved.")}
                onRides={(dir, on) => void run(() => history.setRides(day, ids, dir, on, { note }), "Rides saved.")}
                onRemove={() => setRemoving(ids.filter((id) => stayed.some((r) => r.patientId === id)))}
              />
            ) : null}
          </div>
          {rows.map((r) => (
            <ChildRow
              key={r.patientId}
              row={r}
              data={data}
              mode={mode}
              busy={busy}
              canNights={canNights}
              canRides={canRides}
              selected={selected.has(r.patientId)}
              onSelect={(on) =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (on) next.add(r.patientId);
                  else next.delete(r.patientId);
                  return next;
                })
              }
              run={run}
              note={note}
              onRemove={() => setRemoving([r.patientId])}
            />
          ))}
        </div>
      )}

      <Trips data={data} />
      <Trail data={data} />

      {plan ? (
        <PlanDialog
          title={plan.title}
          nights={plan.nights}
          unmatched={plan.unmatched}
          beds={data.beds}
          busy={busy}
          onClose={() => setPlan(null)}
          onSave={async (nights) => {
            if (await run(() => savePlan(nights), `${nights.length} saved.`)) setPlan(null);
          }}
        />
      ) : null}
      {adding ? (
        <AddChildDialog
          data={data}
          busy={busy}
          onClose={() => setAdding(false)}
          onSave={async (patientId, unitId, carerId) => {
            if (await run(() => history.saveNight(day, patientId, unitId, { carerId, note }), "Night added.")) setAdding(false);
          }}
        />
      ) : null}
      {completing ? (
        <CompleteDialog
          data={data}
          note={note}
          busy={busy}
          onClose={() => setCompleting(false)}
          onComplete={async (fewerOk) => {
            if (await run(() => history.completeDay(day, true, { note, fewerOk }), "The day is complete: the reports now use it.")) setCompleting(false);
          }}
        />
      ) : null}
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.length === 1 ? "this night" : `${removing?.length} nights`}?</AlertDialogTitle>
            <AlertDialogDescription>
              The child is taken off this night. Their meals of this day go too, unless they also slept the night before. The change is kept in the day&apos;s trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const list = removing ?? [];
                setRemoving(null);
                if (list.length) void run(() => history.removeNights(day, list, note), "Removed.");
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Notice({ tone, children }: { tone: "muted" | "warning"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2 text-theme-sm",
        tone === "warning" ? "border-warning/40 bg-warning/10 text-warning-foreground dark:text-warning" : "border-border bg-muted/50 text-muted-foreground"
      )}
    >
      {children}
    </p>
  );
}

const bedLabel = (b: DayBed) => `${b.code}${b.room ? ` · ${b.room}` : ""}${b.temporary ? " (temporary)" : ""}`;

function ChildRow({
  row,
  data,
  mode,
  busy,
  canNights,
  canRides,
  selected,
  onSelect,
  run,
  note,
  onRemove,
}: {
  row: DayRow;
  data: HistoryDayData;
  mode: HistoryMode;
  busy: boolean;
  canNights: boolean;
  canRides: boolean;
  selected: boolean;
  onSelect: (on: boolean) => void;
  run: (action: () => Promise<HistoryResult | HistoryResult[]>, done?: string) => Promise<boolean>;
  note: string;
  onRemove: () => void;
}) {
  const n = row.night;
  const editable = canNights && !n?.open && !(row.caf && data.cafLocked);
  const save = (patch: { unitId?: string; carerId?: string | null; people?: number }) => {
    const unitId = patch.unitId ?? n?.unitId;
    if (!unitId) return;
    void run(() => history.saveNight(data.day, row.patientId, unitId, { carerId: patch.carerId ?? n?.carerId ?? null, people: patch.people ?? n?.people ?? null, note }), "Saved.");
  };
  const mealOk = row.stayed || row.nightBefore;
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border border-border bg-card p-3", selected && "ring-2 ring-primary/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`Select ${row.name}`} />
        <span className="font-medium">{row.name}</span>
        {row.caseNumber ? <span className="text-theme-xs text-muted-foreground">{row.caseNumber}</span> : null}
        {row.caf ? <span className="rounded-md border border-border px-1.5 text-theme-xs text-muted-foreground">NCH billed</span> : null}
        {n?.open ? <span className="rounded-md border border-warning/40 bg-warning/10 px-1.5 text-theme-xs text-warning-foreground dark:text-warning">Open on House Today</span> : null}
        {mode === "transport" ? <span className="text-theme-xs text-muted-foreground">{row.stayed ? "Stayed that night" : "Did not stay that night"}</span> : null}
      </div>

      {mode === "patients" ? (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_auto]">
          <Select value={n?.unitId ?? ""} onValueChange={(v) => save({ unitId: v })} disabled={!editable || busy}>
            <SelectTrigger className="h-10 w-full" aria-label={`Bed of ${row.name}`}>
              <SelectValue placeholder={row.stayed ? "Bed" : "No night: choose a bed to add it"} />
            </SelectTrigger>
            <SelectContent>
              {data.beds.map((b) => {
                const full = b.taken >= b.capacity && b.unitId !== n?.unitId;
                return (
                  <SelectItem key={b.unitId} value={b.unitId} disabled={full}>
                    {bedLabel(b)}
                    {full ? " · taken" : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <Select value={n?.carerId ?? ""} onValueChange={(v) => save({ carerId: v })} disabled={!editable || busy || !n}>
            <SelectTrigger className="h-10 w-full" aria-label={`Carer of ${row.name}`}>
              <SelectValue placeholder="Carer" />
            </SelectTrigger>
            <SelectContent>
              {(row.carers ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                  {c.relationship ? ` (${c.relationship})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={n ? String(n.people) : ""} onValueChange={(v) => save({ people: Number(v) })} disabled={!editable || busy || !n}>
            <SelectTrigger className="h-10 w-full sm:w-36" aria-label={`People with ${row.name}`}>
              <SelectValue placeholder="With the child" />
            </SelectTrigger>
            <SelectContent>
              {[0, 1, 2, 3, 4, 5, 6].map((k) => (
                <SelectItem key={k} value={String(k)}>
                  {k} with the child
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {mode === "patients"
          ? MEALS.map((m) => {
              const on = (row.meals ?? []).includes(m);
              return (
                <Pill
                  key={m}
                  on={on}
                  disabled={!canNights || busy || (!on && !mealOk)}
                  title={!mealOk && !on ? "Add the night first" : `${MEAL_LABEL[m]}${on ? " · served" : ""}`}
                  onClick={() => void run(() => history.setMeals(data.day, [row.patientId], [m], !on, note))}
                >
                  {MEAL_LABEL[m]}
                </Pill>
              );
            })
          : null}
        {DIRECTIONS.map((dir) => {
          const ride = row.rides[dir];
          return (
            <Pill
              key={dir}
              on={!!ride}
              disabled={!canRides || busy}
              title={`${DIRECTION_LABEL[dir]}${ride ? ` · ${ride.people} riding` : ""}`}
              onClick={() => void run(() => history.setRides(data.day, [row.patientId], dir, !ride, { people: (n?.people ?? 1) + 1, note }))}
            >
              {DIRECTION_LABEL[dir]}
              {ride ? ` · ${ride.people}` : ""}
            </Pill>
          );
        })}
        {mode === "patients" && row.stayed && editable ? (
          <Button variant="ghost" className="ml-auto text-destructive" disabled={busy} onClick={onRemove}>
            <Trash2 className="size-4" /> Remove night
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Pill({ on, disabled, title, onClick, children }: { on: boolean; disabled: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center gap-1 rounded-lg border px-3 text-theme-sm font-medium transition-colors disabled:cursor-default disabled:opacity-60",
        on ? "border-success/40 bg-success/12 text-success-foreground dark:text-success" : "border-border text-muted-foreground hover:bg-muted"
      )}
    >
      {on ? <Check className="size-3.5" /> : null}
      {children}
    </button>
  );
}

function BulkActions({
  mode,
  busy,
  canNights,
  canRides,
  onMeals,
  onRides,
  onRemove,
}: {
  mode: HistoryMode;
  busy: boolean;
  canNights: boolean;
  canRides: boolean;
  onMeals: (meals: Meal[], on: boolean) => void;
  onRides: (dir: Direction, on: boolean) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {mode === "patients" && canNights ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={busy}>
              Meals <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onMeals([...MEALS], true)}>Add all three</DropdownMenuItem>
            {MEALS.map((m) => (
              <DropdownMenuItem key={`+${m}`} onClick={() => onMeals([m], true)}>
                Add {MEAL_LABEL[m].toLowerCase()}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {MEALS.map((m) => (
              <DropdownMenuItem key={`-${m}`} onClick={() => onMeals([m], false)}>
                Remove {MEAL_LABEL[m].toLowerCase()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canRides ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" disabled={busy}>
              Rides <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {DIRECTIONS.map((d) => (
              <DropdownMenuItem key={`+${d}`} onClick={() => onRides(d, true)}>
                Add {DIRECTION_LABEL[d]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {DIRECTIONS.map((d) => (
              <DropdownMenuItem key={`-${d}`} onClick={() => onRides(d, false)}>
                Remove {DIRECTION_LABEL[d]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {mode === "patients" && canNights ? (
        <Button variant="outline" className="text-destructive" disabled={busy} onClick={onRemove}>
          <Trash2 className="size-4" /> Remove nights
        </Button>
      ) : null}
    </div>
  );
}

/** "Fill from the sheet" and "Copy the day before": a list to check, each with its bed, then one save. */
function PlanDialog({
  title,
  nights,
  unmatched,
  beds,
  busy,
  onClose,
  onSave,
}: {
  title: string;
  nights: PlannedNight[];
  unmatched: SheetPerson[];
  beds: DayBed[];
  busy: boolean;
  onClose: () => void;
  onSave: (nights: PlannedNight[]) => void;
}) {
  const [list, setList] = React.useState(nights);
  const ready = list.filter((n) => n.mealsOnly || n.unitId);
  // Beds already given to someone in this list, so two children don't land in a single bed.
  const used = new Map<string, number>();
  for (const n of list) if (n.unitId && !n.mealsOnly) used.set(n.unitId, (used.get(n.unitId) ?? 0) + 1);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Check each child&apos;s bed. A child without a bed is left out until one is chosen; meals are ticked after the night is saved.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col divide-y divide-border">
          {list.map((n, i) => (
            <div key={`${n.patientId}-${i}`} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-40 flex-1 font-medium">{n.name}</span>
              {n.mealsOnly ? (
                <span className="text-theme-xs text-muted-foreground">Already has the night: meals only</span>
              ) : (
                <Select value={n.unitId ?? ""} onValueChange={(v) => setList((l) => l.map((x, j) => (j === i ? { ...x, unitId: v } : x)))}>
                  <SelectTrigger className="h-10 w-48" aria-label={`Bed of ${n.name}`}>
                    <SelectValue placeholder="Choose a bed" />
                  </SelectTrigger>
                  <SelectContent>
                    {beds.map((b) => {
                      const full = b.taken + (used.get(b.unitId) ?? 0) >= b.capacity && b.unitId !== n.unitId;
                      return (
                        <SelectItem key={b.unitId} value={b.unitId} disabled={full}>
                          {bedLabel(b)}
                          {full ? " · taken" : ""}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              )}
              <span className="w-full text-theme-xs text-muted-foreground sm:w-auto">{n.meals.length ? n.meals.map((m) => MEAL_LABEL[m]).join(", ") : "No meals on the sheet"}</span>
              <Button variant="ghost" size="icon-sm" aria-label={`Leave ${n.name} out`} onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {list.length === 0 ? <p className="py-3 text-theme-sm text-muted-foreground">Nobody left to add.</p> : null}
        </div>
        {unmatched.length ? (
          <p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-theme-sm text-muted-foreground">
            {unmatched.length} {unmatched.length === 1 ? "name on the sheet is" : "names on the sheet are"} not matched to a patient yet ({unmatched.map((u) => u.name).join(", ")}). Match them on the{" "}
            <Link className="underline" href="/patients/house-sheet">
              House Sheet
            </Link>{" "}
            page, or add the child here with Add a child.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || ready.length === 0} onClick={() => onSave(ready)}>
            {busy ? "Saving…" : `Save ${ready.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddChildDialog({ data, busy, onClose, onSave }: { data: HistoryDayData; busy: boolean; onClose: () => void; onSave: (patientId: string, unitId: string, carerId: string | null) => void }) {
  const { patients, carers } = usePatientsData();
  const [search, setSearch] = React.useState("");
  const [patientId, setPatientId] = React.useState<string | null>(null);
  const [unitId, setUnitId] = React.useState<string>("");
  const [carerId, setCarerId] = React.useState<string>("");
  const here = new Set(data.rows.filter((r) => r.stayed).map((r) => r.patientId));
  const words = search.trim().toLowerCase();
  const found = words.length < 2 ? [] : patients.filter((p) => !here.has(p.id) && `${p.firstName} ${p.lastName} ${p.patientNumber}`.toLowerCase().includes(words)).slice(0, 8);
  const chosen = patients.find((p) => p.id === patientId);
  const theirCarers = carers.filter((c) => c.patientId === patientId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a child to {formatDate(data.day, "MMMM d")}</DialogTitle>
          <DialogDescription>Search by name or LFCN, then choose the bed they slept in.</DialogDescription>
        </DialogHeader>
        {chosen ? (
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <span className="font-medium">
              {chosen.firstName} {chosen.lastName} <span className="text-theme-xs text-muted-foreground">{chosen.patientNumber}</span>
            </span>
            <Button variant="ghost" onClick={() => setPatientId(null)}>
              Change
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or LFCN" aria-label="Search for a child" />
            {found.map((p) => (
              <button key={p.id} type="button" className="flex min-h-11 items-center justify-between rounded-lg px-3 text-left hover:bg-muted" onClick={() => setPatientId(p.id)}>
                <span>
                  {p.firstName} {p.lastName}
                </span>
                <span className="text-theme-xs text-muted-foreground">{p.patientNumber}</span>
              </button>
            ))}
            {words.length >= 2 && found.length === 0 ? <p className="px-1 text-theme-sm text-muted-foreground">No child found, or they already have this night.</p> : null}
          </div>
        )}
        {chosen ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={unitId} onValueChange={setUnitId}>
              <SelectTrigger className="h-10 w-full" aria-label="Bed">
                <SelectValue placeholder="Bed" />
              </SelectTrigger>
              <SelectContent>
                {data.beds.map((b) => (
                  <SelectItem key={b.unitId} value={b.unitId} disabled={b.taken >= b.capacity}>
                    {bedLabel(b)}
                    {b.taken >= b.capacity ? " · taken" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={carerId} onValueChange={setCarerId}>
              <SelectTrigger className="h-10 w-full" aria-label="Carer">
                <SelectValue placeholder="Carer (the one on file if left)" />
              </SelectTrigger>
              <SelectContent>
                {theirCarers.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.relationship ? ` (${c.relationship})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !chosen || !unitId} onClick={() => chosen && onSave(chosen.id, unitId, carerId || null)}>
            <Plus className="size-4" /> Add the night
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CompleteDialog({ data, note, busy, onClose, onComplete }: { data: HistoryDayData; note: string; busy: boolean; onClose: () => void; onComplete: (fewerOk: boolean) => void }) {
  const [fewerOk, setFewerOk] = React.useState(false);
  const children = data.rows.filter((r) => r.stayed).length;
  const sheet = data.sheet.filter((p) => p.slept).length;
  const meals = data.rows.reduce((s, r) => s + (r.meals?.length ?? 0), 0);
  const rides = data.rows.reduce((s, r) => s + Object.keys(r.rides).length, 0);
  const fewer = children < sheet;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark {formatDate(data.day, "MMMM d")} complete?</DialogTitle>
          <DialogDescription>From then on the reports (Bed Nights, NCH billing, the Programs report) read this day from the app, not the sheets.</DialogDescription>
        </DialogHeader>
        <p className="rounded-xl border border-border px-3 py-2 text-theme-sm">
          {children} children · {children} beds · {meals} meals · {rides} rides
          <br />
          <span className="text-muted-foreground">The House Sheet lists {sheet} that night.</span>
        </p>
        {fewer ? (
          <label className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-theme-sm text-warning-foreground dark:text-warning">
            <Checkbox checked={fewerOk} onCheckedChange={(v) => setFewerOk(v === true)} className="mt-0.5" />
            <span>
              Complete it with {sheet - children} fewer {sheet - children === 1 ? "child" : "children"} than the House Sheet. The note above says why.
              {!note.trim() ? <strong className="block">Write the note first.</strong> : null}
            </span>
          </label>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || (fewer && (!fewerOk || !note.trim()))} onClick={() => onComplete(fewer)}>
            <Check className="size-4" /> Mark complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Trips({ data }: { data: HistoryDayData }) {
  if (data.trips.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-theme-sm font-semibold">Trips that day</h4>
      <ul className="text-theme-sm text-muted-foreground">
        {data.trips.map((t) => (
          <li key={t.id}>
            {DIRECTION_LABEL[t.direction]} · {t.fromHistory ? "entered in History" : `${formatTime12(t.time)}, ${t.vehicle}`}
            {t.driver ? ` · ${t.driver}` : ""} · {t.riders} {t.riders === 1 ? "child" : "children"}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Trail({ data }: { data: HistoryDayData }) {
  if (data.edits.length === 0) return null;
  return (
    <details className="rounded-2xl border border-border p-3">
      <summary className="cursor-pointer text-theme-sm font-semibold">Changes to this day ({data.edits.length})</summary>
      <ul className="mt-2 flex flex-col gap-1 text-theme-xs text-muted-foreground">
        {data.edits.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            {formatDate(e.at, "MMM d, h:mm a")} · {e.by ?? "Someone"} {ACTION_LABEL[e.action] ?? e.action}
            {e.patient ? ` for ${e.patient}` : ""}
            {e.note ? ` · “${e.note}”` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
