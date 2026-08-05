"use client";

import Link from "next/link";
import { Search, LogOut } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationCenter } from "@/components/layout/notification-center";
import { ClockStatusBadge } from "@/components/layout/clock-status-badge";
import { useRole } from "@/lib/rbac/use-role";
import { ROLES } from "@/lib/types/common";

export function Topbar({ onSearchClick }: { onSearchClick: () => void }) {
  const { role, user } = useRole();
  const roleLabel = ROLES.find((r) => r.value === role)?.label ?? role;
  const initials = user
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
      <SidebarTrigger className="rounded-full" />
      <Separator orientation="vertical" className="h-5" />
      <Breadcrumbs />

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSearchClick}
          className="hidden w-64 items-center gap-2 rounded-full border bg-background px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/40 sm:flex"
        >
          <Search className="size-4 shrink-0" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="shrink-0 rounded-full border bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
        </button>
        <Button variant="ghost" size="icon" className="rounded-full sm:hidden" onClick={onSearchClick}>
          <Search className="size-4" />
        </Button>
        <ClockStatusBadge />
        <ThemeToggle />
        <NotificationCenter />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 rounded-full px-2">
              <Avatar className="size-7">
                <AvatarFallback className="bg-blue-50 text-[11px] font-semibold text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium md:inline">{user}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex flex-col">
              <span>{user}</span>
              <span className="text-xs font-normal text-muted-foreground">{roleLabel}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/login">
                <LogOut />
                Log out
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
