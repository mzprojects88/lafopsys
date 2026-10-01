"use client";

import Link from "next/link";
import { Bell, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useRole } from "@/context/role-provider";
import { useAppSettings } from "@/lib/hooks/use-app-settings";

/** Something an admin still has to set up. Worked out from the settings, so it
 * can't be dismissed: it goes away once the thing is done. */
interface Reminder {
  id: string;
  title: string;
  body: string;
  href: string;
}

/** The bell: real reminders only (the demo entries it used to show were removed
 * 2026-10-01). New alerts belong here as Reminders worked out from live data. */
export function NotificationCenter() {
  const { role } = useRole();
  const settings = useAppSettings();
  const reminders: Reminder[] = [];
  // DTR (0063): without the pin, clock-ins can't be checked against the 20 m radius.
  if (role === "admin" && !settings.loading && (settings.lafHouse.lat == null || settings.lafHouse.lng == null)) {
    reminders.push({
      id: "laf-house-location",
      title: "Set the LAF House location",
      body: "Clock-ins aren't checked against the house yet. Pin the house in Settings › Attendance Policy.",
      href: "/settings#attendance-policy",
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-lg" className="relative" aria-label={reminders.length ? `Notifications: ${reminders.length} need action` : "Notifications"}>
          <Bell className="size-4.5" />
          {reminders.length > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {reminders.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-0 overflow-hidden rounded-2xl p-0">
        <div className="border-b px-5 py-4 text-base font-medium">Notifications</div>
        {reminders.length === 0 ? (
          <p className="px-5 py-8 text-center text-theme-sm text-muted-foreground">You&apos;re all caught up.</p>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="flex flex-col">
              {reminders.map((r) => (
                <Link
                  key={r.id}
                  href={r.href}
                  className="flex gap-3 border-b bg-warning/10 px-5 py-3 text-left text-theme-sm last:border-b-0 hover:bg-warning/15"
                >
                  <MapPin className="mt-0.5 size-4 shrink-0 text-warning" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{r.title}</span>
                    <span className="text-xs text-muted-foreground">{r.body}</span>
                    <span className="text-[11px] font-medium text-warning-foreground dark:text-warning">Action needed</span>
                  </span>
                </Link>
              ))}
            </div>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
