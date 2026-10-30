"use client";

import dynamic from "next/dynamic";
import type { MapPoint } from "@/components/patterns/place-map";

// Leaflet needs the browser; the printed map is the same free OpenStreetMap one (0123).
const PlaceMap = dynamic(() => import("@/components/patterns/place-map").then((m) => m.PlaceMap), { ssr: false });

export function ManifestMap({ points }: { points: MapPoint[] }) {
  return <PlaceMap points={points} className="h-48 print:h-44" />;
}
