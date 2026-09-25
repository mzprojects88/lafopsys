"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SidebarProvider, useSidebar } from "@/context/sidebar-provider";
import { AppSidebar } from "@/components/layout/sidebar-nav";
import { Header } from "@/components/layout/header";
import { Topbar } from "@/components/layout/topbar";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ClockInGate } from "@/components/layout/clock-in-gate";
import { CommandPalette } from "@/components/layout/command-palette";
import { ModuleGate } from "@/components/layout/module-gate";
import { ShiftReminder } from "@/components/layout/shift-reminder";
import { MissedClockOutPrompt } from "@/components/modules/staff/missed-clock-out-prompt";

/**
 * The app frame, LAF Inventory's layout (DESIGN.md): from lg a 290/90 px
 * sidebar and a 64 px header; below lg a top bar and the bottom tabs. Every
 * page brings its own PageHeader inside.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Frame>{children}</Frame>
    </SidebarProvider>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  const { expanded } = useSidebar();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const openPalette = () => setPaletteOpen(true);

  return (
    <div className="flex min-h-svh flex-col">
      <AppSidebar />
      <div className={cn("flex min-h-svh min-w-0 flex-1 flex-col transition-[margin] duration-200 ease-out", expanded ? "lg:ml-[290px]" : "lg:ml-[90px]")}>
        <Topbar onSearchClick={openPalette} />
        <Header onSearchClick={openPalette} />
        <main className="mx-auto flex w-full max-w-(--breakpoint-2xl) flex-1 flex-col gap-4 px-4 pt-4 pb-24 lg:gap-6 lg:px-6 lg:pt-6 lg:pb-10">
          <ShiftReminder />
          <MissedClockOutPrompt />
          <ClockInGate>
            <ModuleGate>{children}</ModuleGate>
          </ClockInGate>
        </main>
        <BottomNav />
      </div>
      <CommandPalette externalOpen={paletteOpen} onExternalOpenChange={setPaletteOpen} />
    </div>
  );
}
