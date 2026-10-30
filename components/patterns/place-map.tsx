"use client";

import * as React from "react";
import "leaflet/dist/leaflet.css";
import type { LatLng } from "@/lib/utils/places";
import { cn } from "@/lib/utils";

export interface MapPoint extends LatLng {
  label: string;
  /** LAF House is drawn green, a destination red. */
  kind: "home" | "place";
}

/**
 * A free OpenStreetMap map (0123): LAF House and the places pinned on it, and, when `onPick` is
 * given, a click sets a pin. Leaflet loads in the browser only. Circle markers, so no image assets.
 * OpenStreetMap's tile policy allows this light use with the attribution shown.
 */
export function PlaceMap({ points, onPick, className }: { points: readonly MapPoint[]; onPick?: (at: LatLng) => void; className?: string }) {
  const box = React.useRef<HTMLDivElement>(null);
  const pick = React.useRef(onPick);
  React.useEffect(() => {
    pick.current = onPick;
  }, [onPick]);
  const key = points.map((p) => `${p.kind}:${p.lat},${p.lng}:${p.label}`).join("|");

  React.useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !box.current) return;
      map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      const latlngs: [number, number][] = [];
      for (const p of points) {
        const color = p.kind === "home" ? "#16a34a" : "#dc2626";
        L.circleMarker([p.lat, p.lng], { radius: 8, color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 1 })
          .bindTooltip(p.label, { permanent: true, direction: "top", offset: [0, -8] })
          .addTo(map);
        latlngs.push([p.lat, p.lng]);
      }
      if (latlngs.length > 1) map.fitBounds(latlngs, { padding: [36, 36], maxZoom: 16 });
      else map.setView(latlngs[0] ?? [14.5995, 120.9842], latlngs.length ? 15 : 11); // Metro Manila when nothing is pinned yet
      map.on("click", (e: import("leaflet").LeafletMouseEvent) => pick.current?.({ lat: Math.round(e.latlng.lat * 1e6) / 1e6, lng: Math.round(e.latlng.lng * 1e6) / 1e6 }));
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // Redrawn when the pins change; `points` itself is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={box} className={cn("z-0 h-56 w-full overflow-hidden rounded-xl border border-border", onPick && "cursor-crosshair", className)} role="img" aria-label={`Map: ${points.map((p) => p.label).join(", ") || "no pins yet"}`} />;
}
