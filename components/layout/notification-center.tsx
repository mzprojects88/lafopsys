"use client";

import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { notifications } from "@/lib/mock-data";
import { useLocalCollection } from "@/lib/store/use-mock-store";
import { formatRelative } from "@/lib/utils/date";
import { cn } from "@/lib/utils";

export function NotificationCenter() {
  const { items, updateItem } = useLocalCollection("notifications", notifications);
  const unreadCount = items.filter((n) => !n.read).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-lg" className="relative" aria-label="Notifications">
          <Bell className="size-4.5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 overflow-hidden rounded-2xl p-0">
        <div className="border-b px-5 py-4 text-base font-medium">Notifications</div>
        <ScrollArea className="h-80">
          <div className="flex flex-col">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => updateItem(n.id, { read: true })}
                className={cn(
                  "flex flex-col gap-0.5 border-b px-5 py-3 text-left text-theme-sm last:border-b-0 hover:bg-muted/60",
                  !n.read && "bg-accent/50"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{n.title}</span>
                  {!n.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
                </div>
                <span className="text-xs text-muted-foreground">{n.body}</span>
                <span className="text-[11px] text-muted-foreground">{formatRelative(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
