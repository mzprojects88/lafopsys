"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useProgramHistory, type HistoryLine, type ProgramHistoryRow } from "@/lib/hooks/use-program-impact";

const LINES: { key: HistoryLine; label: string }[] = [
  { key: "housing", label: "Housing (people-nights)" },
  { key: "transportation", label: "Transportation (people)" },
  { key: "meals", label: "Meals (people)" },
  { key: "center", label: "LAF Center @ NCH (participants)" },
  { key: "care_cart", label: "Care Cart (people)" },
];

/** The years before the app, typed once (the website's 2024 / 2025 columns). */
export function PriorYearsDialog({ years, onClose }: { years: number[]; onClose: () => void }) {
  const { history, save } = useProgramHistory();
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const value = (y: number, l: HistoryLine) => draft[`${y}|${l}`] ?? String(history.find((h) => h.year === y && h.line === l)?.value ?? "");

  async function submit() {
    const rows: ProgramHistoryRow[] = [];
    for (const [k, v] of Object.entries(draft)) {
      const [y, l] = k.split("|");
      const n = Number(v);
      if (v.trim() === "" || !Number.isFinite(n) || n < 0) return void toast.error("Figures have to be whole numbers, zero or more.");
      rows.push({ year: Number(y), line: l as HistoryLine, value: Math.round(n) });
    }
    if (!rows.length) return onClose();
    setSaving(true);
    const r = await save(rows);
    setSaving(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Prior years saved.");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prior years</DialogTitle>
          <DialogDescription>The totals of the years before the app, as the website shows them beside this year. Typed once; the app computes this year.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {LINES.map((l) => (
            <div key={l.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <Label className="text-theme-sm">{l.label}</Label>
              {years.map((y) => (
                <div key={y} className="flex flex-col gap-1">
                  <span className="text-theme-xs text-muted-foreground">{y}</span>
                  <Input type="number" inputMode="numeric" min={0} className="w-28" value={value(y, l.key)} onChange={(e) => setDraft({ ...draft, [`${y}|${l.key}`]: e.target.value })} aria-label={`${l.label} ${y}`} />
                </div>
              ))}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
