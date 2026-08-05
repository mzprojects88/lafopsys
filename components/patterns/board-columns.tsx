import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/patterns/empty-state";
import { CATEGORY_COLOR_CLASSES, type CategoryColor } from "@/lib/utils/category-colors";

export interface BoardColumn<T> {
  id: string;
  title: string;
  items: T[];
  color?: CategoryColor;
  icon?: LucideIcon;
}

interface BoardColumnsProps<T> {
  columns: BoardColumn<T>[];
  renderItem: (item: T) => React.ReactNode;
  getItemKey: (item: T) => string;
  className?: string;
}

const COLUMN_BG: Record<CategoryColor, string> = {
  blue: "bg-blue-50/60 dark:bg-blue-500/5",
  cyan: "bg-cyan-50/60 dark:bg-cyan-500/5",
  teal: "bg-teal-50/60 dark:bg-teal-500/5",
  green: "bg-emerald-50/60 dark:bg-emerald-500/5",
  amber: "bg-amber-50/60 dark:bg-amber-500/5",
  orange: "bg-orange-50/60 dark:bg-orange-500/5",
  purple: "bg-violet-50/60 dark:bg-violet-500/5",
  indigo: "bg-indigo-50/60 dark:bg-indigo-500/5",
  rose: "bg-rose-50/60 dark:bg-rose-500/5",
  red: "bg-red-50/60 dark:bg-red-500/5",
  slate: "bg-slate-50 dark:bg-slate-500/5",
};

export function BoardColumns<T>({ columns, renderItem, getItemKey, className }: BoardColumnsProps<T>) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {columns.map((col) => {
        const color = col.color ?? "slate";
        const classes = CATEGORY_COLOR_CLASSES[color];
        const Icon = col.icon;
        return (
          <div key={col.id} className={cn("flex flex-col gap-3 rounded-xl border p-3", COLUMN_BG[color])}>
            <div className="flex items-center justify-between px-0.5">
              <span className={cn("flex items-center gap-1.5 text-sm font-semibold", classes.text)}>
                {Icon && <Icon className="size-4" />}
                {col.title}
              </span>
              <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold", classes.bg, classes.text)}>
                {col.items.length}
              </span>
            </div>
            <div className="flex flex-col gap-2">
              {col.items.length === 0 ? (
                <EmptyState title="Empty" className="border-none bg-transparent py-6" />
              ) : (
                col.items.map((item) => <div key={getItemKey(item)}>{renderItem(item)}</div>)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
