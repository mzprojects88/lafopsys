import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/patterns/empty-state";
import type { CategoryColor } from "@/lib/utils/category-colors";

export interface BoardColumn<T> {
  id: string;
  title: string;
  items: T[];
  /** @deprecated Columns share one surface now (DESIGN.md). */
  color?: CategoryColor;
  icon?: LucideIcon;
}

interface BoardColumnsProps<T> {
  columns: BoardColumn<T>[];
  renderItem: (item: T) => React.ReactNode;
  getItemKey: (item: T) => string;
  className?: string;
}

export function BoardColumns<T>({ columns, renderItem, getItemKey, className }: BoardColumnsProps<T>) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {columns.map((col) => {
        const Icon = col.icon;
        return (
          <div key={col.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-3">
            <div className="flex items-center justify-between px-1">
              <span className="flex items-center gap-1.5 text-theme-sm font-medium text-foreground">
                {Icon && <Icon className="size-4 text-muted-foreground" strokeWidth={1.75} />}
                {col.title}
              </span>
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-card px-1.5 text-[11px] font-medium text-muted-foreground">
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
