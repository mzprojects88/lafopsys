"use client";

import { BedDouble, Bus, CalendarClock, Car, Home, KanbanSquare, LayoutGrid, ListOrdered, Share2, Users } from "lucide-react";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";
import { useSheetChanges } from "@/lib/hooks/use-sheet-changes";

/**
 * The patients module in the order a day runs: NCH's sheet first (arrivals,
 * tonight's beds, departures), then the boards, then the records. Pages
 * hidden on this deployment drop out by themselves (ModuleSubNav).
 */
export const PATIENTS_SUB_NAV: ModuleSubNavItem[] = [
  { href: "/patients/house-sheet", label: "House Sheet", icon: Home },
  { href: "/patients/today", label: "Today Board", icon: KanbanSquare },
  { href: "/patients/floor-plan", label: "Floor Plan", icon: LayoutGrid },
  { href: "/patients", label: "All Patients", icon: Users },
  { href: "/patients/appointments", label: "Appointments", icon: CalendarClock },
  { href: "/patients/manifest", label: "Manifest", icon: Bus },
  { href: "/patients/rides", label: "Rides", icon: Car },
  { href: "/patients/stays", label: "Stay History", icon: BedDouble },
  { href: "/patients/waitlist", label: "Waitlist", icon: ListOrdered },
  { href: "/patients/referrals", label: "Referrals", icon: Share2 },
];

/** Every patients page carries it, so a phone never has to go back to jump. */
export function PatientsSubNav({ except }: { except?: string }) {
  // Changes on the original sheet waiting for review (0064) live on All Patients: say so from every page.
  const waiting = useSheetChanges().pending.length;
  const items = PATIENTS_SUB_NAV.filter((i) => i.href !== except).map((i) =>
    i.href === "/patients" && waiting > 0 ? { ...i, label: `${i.label} · ${waiting} to review` } : i
  );
  return <ModuleSubNav items={items} />;
}
