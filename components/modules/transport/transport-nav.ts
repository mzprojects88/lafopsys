import { Bus, Fuel } from "lucide-react";
import type { ModuleSubNavItem } from "@/components/patterns/module-subnav";

/** Transport's two pages (Fuel Monitoring, 0079). */
export const TRANSPORT_SUB_NAV: ModuleSubNavItem[] = [
  { href: "/transport", label: "Trips", icon: Bus },
  { href: "/transport/fuel", label: "Fuel Monitoring", icon: Fuel },
];
