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
  { href: "/patients/house-sheet", label: "House Sheet", icon: Home, color: "teal" },
  { href: "/patients/today", label: "Today Board", icon: KanbanSquare, color: "blue" },
  { href: "/patients/floor-plan", label: "Floor Plan", icon: LayoutGrid, color: "cyan" },
  { href: "/patients", label: "All Patients", icon: Users, color: "indigo" },
  { href: "/patients/appointments", label: "Appointments", icon: CalendarClock, color: "purple" },
  { href: "/patients/manifest", label: "Manifest", icon: Bus, color: "green" },
  { href: "/patients/rides", label: "Rides", icon: Car, color: "amber" },
  { href: "/patients/stays", label: "Stay History", icon: BedDouble, color: "slate" },
  { href: "/patients/waitlist", label: "Waitlist", icon: ListOrdered, color: "amber" },
  { href: "/patients/referrals", label: "Referrals", icon: Share2, color: "purple" },
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
