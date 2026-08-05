"use client";

import * as React from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useLocalCollection } from "@/lib/store/use-mock-store";

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

const seedChecklist: ChecklistItem[] = [
  { id: "close-1", label: "Reconcile bank statements (PH + US)", done: true },
  { id: "close-2", label: "Post all pending cash entries", done: true },
  { id: "close-3", label: "Verify AR sequence has no gaps", done: false },
  { id: "close-4", label: "Verify Donee Cert register has no gaps", done: false },
  { id: "close-5", label: "Review program allocation against budget", done: false },
  { id: "close-6", label: "Confirm inter-entity transfer amounts match on both sides", done: false },
  { id: "close-7", label: "Generate monthly board pack", done: false },
];

export default function MonthlyClosePage() {
  const { items, updateItem } = useLocalCollection<ChecklistItem>("finance-close-checklist", seedChecklist);
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);

  return (
    <div className="flex max-w-xl flex-1 flex-col gap-6">
      <PageHeader title="Monthly Close" description="Checklist for closing the current accounting period." />

      <div className="flex items-center gap-3">
        <Progress value={pct} className="h-2" />
        <span className="whitespace-nowrap text-sm text-muted-foreground">{doneCount} / {items.length}</span>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-1 pt-6">
          {items.map((item) => (
            <label key={item.id} className="flex items-center gap-3 rounded-md px-2 py-2.5 text-sm hover:bg-accent">
              <Checkbox
                checked={item.done}
                onCheckedChange={(checked) => {
                  updateItem(item.id, { done: !!checked });
                  if (checked) toast.success("Checked off");
                }}
              />
              <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.label}</span>
            </label>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
