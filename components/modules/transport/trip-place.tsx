"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { DEFAULT_HOSPITAL } from "@/lib/utils/trip-direction";
import { directionsUrl, estimateRoadKm, findPlace, type LatLng, type Place } from "@/lib/utils/places";
import { ROUTE_MIN_TRIPS } from "@/lib/utils/odometer";

// Leaflet touches `window`: the map loads in the browser only, and only when opened.
const PlaceMap = dynamic(() => import("@/components/patterns/place-map").then((m) => m.PlaceMap), { ssr: false });

export interface PlaceEstimate {
  km: number;
  /** "LAF House → National Children's Hospital and back" */
  route: string;
}

/**
 * The saved place a trip goes to (0123) and the by-map km for it: one way for a delivery to the
 * hospital (it arrives there), there and back for a pick-up or an errand (they end at LAF House).
 * A pick-up names no destination; it goes to the default hospital.
 */
export function useTripPlace(direction: string, destination: string | null): { place: Place | null; home: LatLng | null; estimate: PlaceEstimate | null } {
  const { transportPlaces, lafHouse } = useAppSettings();
  const place = findPlace(transportPlaces, destination ?? (direction === "from_hospital" ? DEFAULT_HOSPITAL : null));
  const home = lafHouse.lat != null && lafHouse.lng != null ? { lat: lafHouse.lat, lng: lafHouse.lng } : null;
  if (!place || !home) return { place, home, estimate: null };
  const oneWay = estimateRoadKm(home, place);
  const there = direction === "to_hospital";
  return { place, home, estimate: { km: there ? oneWay : oneWay * 2, route: `LAF House → ${place.name}${there ? "" : " and back"}` } };
}

/** On a trip card: directions in Google Maps, the free map with both pins, and the by-map km while the route has no history. */
export function TripPlace({ direction, destination, usualTrips }: { direction: string; destination: string | null; usualTrips: number }) {
  const { place, home, estimate } = useTripPlace(direction, destination);
  const [open, setOpen] = React.useState(false);
  if (!place) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-theme-xs">
        <a href={directionsUrl(place, home)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
          <Navigation className="size-3.5" /> Directions to {place.name}
        </a>
        <Button type="button" variant="link" size="sm" className="h-auto gap-1 p-0 text-theme-xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <MapPin className="size-3.5" /> {open ? "Hide map" : "Map"}
        </Button>
        {estimate && usualTrips < ROUTE_MIN_TRIPS ? <span className="text-muted-foreground">By map, about {estimate.km} km ({estimate.route}); an estimate until 3 trips are logged.</span> : null}
      </div>
      {open ? <PlaceMap points={[...(home ? [{ ...home, label: "LAF House", kind: "home" as const }] : []), { ...place, label: place.name, kind: "place" as const }]} /> : null}
    </div>
  );
}
