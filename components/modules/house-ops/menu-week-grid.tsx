"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dietLabel, weekStock, type MenuMeal, type StockStatus } from "@/lib/utils/menu-week-ui";
import { weekDates } from "@/lib/ai/menu-week";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TONE: Record<"positive" | "warning" | "neutral" | "negative", string> = {
  positive: "border-none bg-success/12 text-success-foreground dark:bg-success/15 dark:text-success",
  warning: "border-none bg-warning/12 text-warning-foreground dark:bg-warning/15 dark:text-warning",
  negative: "border-none bg-destructive/10 text-destructive dark:bg-destructive/15",
  neutral: "border-none bg-muted text-muted-foreground",
};
const STOCK: Record<StockStatus, { label: string; tone: keyof typeof TONE }> = {
  covered: { label: "In stock", tone: "positive" },
  short: { label: "Short", tone: "negative" },
  unknown: { label: "No quantities", tone: "neutral" },
};
const STATUS: Record<MenuMeal["status"], { label: string; tone: keyof typeof TONE }> = {
  draft: { label: "Draft", tone: "neutral" },
  pending_nutritionist: { label: "For review", tone: "warning" },
  approved: { label: "Approved", tone: "positive" },
  rejected: { label: "Rejected", tone: "negative" },
};

/**
 * The week as a grid, days down and meals across (0068). The same component shape lives in LAF
 * Inventory (components/modules/menu/menu-week-grid.tsx): keep the two alike.
 */
export function MenuWeekGrid({
  weekStart,
  mealTypes,
  meals,
  onHand,
  itemName,
  canEdit,
  onEdit,
}: {
  weekStart: string;
  mealTypes: { value: string; label: string }[];
  meals: MenuMeal[];
  /** On-hand quantity per item id, for the stock chip. */
  onHand: ReadonlyMap<string, number>;
  itemName: (id: string) => string;
  canEdit: boolean;
  onEdit: (date: string, mealType: string, meal: MenuMeal | null) => void;
}) {
  const stock = React.useMemo(() => weekStock(meals, onHand), [meals, onHand]);
  const byCell = new Map(meals.map((m) => [`${m.date}|${m.mealType}`, m]));
  const dates = weekDates(weekStart);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card">
      <table className="w-full min-w-[720px] text-theme-sm">
        <thead>
          <tr className="border-b border-border text-left text-theme-xs text-muted-foreground">
            <th className="h-10 w-24 px-3 font-medium">Day</th>
            {mealTypes.map((t) => (
              <th key={t.value} className="h-10 px-3 font-medium">
                {t.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dates.map((date, i) => (
            <tr key={date} className={cn("border-b border-border align-top last:border-0", date === today && "bg-accent/30")}>
              <td className="px-3 py-2.5 whitespace-nowrap">
                <p className="font-medium">{DAYS[i]}</p>
                <p className="text-theme-xs text-muted-foreground">{date.slice(5).replace("-", "/")}</p>
              </td>
              {mealTypes.map((t) => {
                const m = byCell.get(`${date}|${t.value}`) ?? null;
                const s = m ? stock.get(m.id) : undefined;
                const diet = m ? dietLabel(m) : null;
                return (
                  <td key={t.value} className="px-2 py-2">
                    <button
                      type="button"
                      disabled={!canEdit && !m}
                      onClick={() => onEdit(date, t.value, m)}
                      className={cn("flex w-full flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left transition-colors", m ? "border-border bg-background hover:bg-muted/60" : "border-dashed border-border text-muted-foreground hover:bg-muted/40", !canEdit && !m && "cursor-default")}
                    >
                      {m ? (
                        <>
                          <span className="font-medium leading-snug">{m.dish}</span>
                          <span className="text-theme-xs text-muted-foreground">
                            {m.servings} servings{m.source === "ai" ? " · AI" : ""}
                          </span>
                          <span className="flex flex-wrap gap-1">
                            <Badge className={TONE[STATUS[m.status].tone]}>{STATUS[m.status].label}</Badge>
                            {s ? (
                              <Badge className={TONE[STOCK[s.status].tone]} title={s.short.length ? `Short: ${s.short.map(itemName).join(", ")}` : undefined}>
                                {STOCK[s.status].label}
                              </Badge>
                            ) : null}
                            {diet && (diet.tone !== "neutral" || m.alternatives.length) ? <Badge className={TONE[diet.tone]}>{diet.label}</Badge> : null}
                          </span>
                        </>
                      ) : (
                        <span className="text-theme-xs">{canEdit ? "Add a dish" : "—"}</span>
                      )}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {!meals.length && canEdit ? (
        <div className="border-t border-border px-4 py-3 text-theme-xs text-muted-foreground">
          <Button variant="link" className="h-auto p-0 text-theme-xs" onClick={() => onEdit(dates[0]!, mealTypes[0]?.value ?? "lunch", null)}>
            Add a dish by hand
          </Button>
          , or let the AI suggest the whole week from the stock on hand.
        </div>
      ) : null}
    </div>
  );
}
