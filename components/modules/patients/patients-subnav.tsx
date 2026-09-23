"use client";

import { BedDouble, Bus, CalendarClock, Car, Home, KanbanSquare, LayoutGrid, ListOrdered, Share2, Users } from "lucide-react";
import { ModuleSubNav, type ModuleSubNavItem } from "@/components/patterns/module-subnav";

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
  return <ModuleSubNav items={PATIENTS_SUB_NAV.filter((i) => i.href !== except)} />;
}
