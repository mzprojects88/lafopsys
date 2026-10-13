import { Bus, FileSpreadsheet, Fuel } from "lucide-react";
import type { ModuleSubNavItem } from "@/components/patterns/module-subnav";

/** Transport's pages: trips, Fuel Monitoring (0079) and the report with CSV downloads (go-live 2026-10-13). */
export const TRANSPORT_SUB_NAV: ModuleSubNavItem[] = [
  { href: "/transport", label: "Trips", icon: Bus },
  { href: "/transport/fuel", label: "Fuel Monitoring", icon: Fuel },
  { href: "/transport/report", label: "Report", icon: FileSpreadsheet },
];
