"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEALS, useMealsServed, type Meal } from "@/lib/hooks/use-meals-served";
import { plainError } from "@/lib/utils/plain-error";

const LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

/**
 * Today's breakfast, lunch and dinner for one family on House Today (0095): a tick means the
 * patient and the carer were served. Read-only for anyone who may not tick.
 */
export function MealTicks({ patientId, name, canTick }: { patientId: string; name: string; canTick: boolean }) {
  const { isServed, toggle } = useMealsServed();
  const [busy, setBusy] = React.useState<Meal | null>(null);

  async function flip(meal: Meal) {
    setBusy(meal);
    const r = await toggle(patientId, meal);
    setBusy(null);
    if (!r.ok) toast.error(plainError(r.error));
  }

  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Meals served today to ${name}`}>
      {MEALS.map((meal) => {
        const served = isServed(patientId, meal);
        return (
          <button
            key={meal}
            type="button"
            disabled={!canTick || busy !== null}
            aria-pressed={served}
            aria-label={`${LABEL[meal]} ${served ? "served" : "not served"}`}
            title={`${LABEL[meal]}${served ? " · served" : ""}`}
            onClick={() => void flip(meal)}
            className={cn(
              "flex h-7 items-center gap-1 rounded-lg border px-2 text-theme-xs font-medium transition-colors disabled:cursor-default",
              served ? "border-success/40 bg-success/12 text-success-foreground dark:text-success" : "border-border text-muted-foreground",
              canTick && !served && "hover:bg-muted"
            )}
          >
            {served ? <Check className="size-3" /> : null}
            <span>
              {LABEL[meal].slice(0, 1)}
              <span className="hidden sm:inline">{LABEL[meal].slice(1)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
