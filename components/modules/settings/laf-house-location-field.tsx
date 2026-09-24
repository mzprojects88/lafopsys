"use client";

import * as React from "react";
import { toast } from "sonner";
import { Crosshair, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useRole } from "@/lib/rbac/use-role";
import { updateLafHouseLocation } from "@/app/(app)/settings/actions";

/**
 * Where LAF House is, for the DTR's on-site check (0063): a punch within the
 * radius of this pin is on-site, anywhere else off-site with its address.
 * Best set standing at the house with "Use my current location" -- the same
 * phone GPS the punches use -- or by pasting the pin's coordinates from
 * Google Maps (long-press the pin; the numbers show at the top).
 */
export function LafHouseLocationField() {
  const { lafHouse, loading } = useAppSettings();
  if (loading) return null;
  return <LafHouseLocationForm key={`${lafHouse.lat},${lafHouse.lng},${lafHouse.radiusM}`} initial={lafHouse} />;
}

function LafHouseLocationForm({ initial }: { initial: { lat: number | null; lng: number | null; radiusM: number } }) {
  const { refetch } = useAppSettings();
  const { role } = useRole();
  const canEdit = role === "admin";
  const [coords, setCoords] = React.useState(initial.lat === null ? "" : `${initial.lat}, ${initial.lng}`);
  const [radius, setRadius] = React.useState(String(initial.radiusM));
  const [locating, setLocating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // "14.627712, 121.026051" as Google Maps copies it; blank clears the pin.
  const parsed = coords.trim() === "" ? { lat: null, lng: null } : (() => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(coords);
    return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
  })();

  function useHere() {
    if (!navigator.geolocation) {
      toast.error("This device cannot report its location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setCoords(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
        toast.info(`Position found (±${Math.round(p.coords.accuracy)} m). Save to use it.`);
      },
      () => {
        setLocating(false);
        toast.error("Couldn't get this device's location. Allow location for this site and try again.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function save() {
    if (!parsed) {
      toast.error('Write the coordinates as "latitude, longitude", e.g. 14.627712, 121.026051.');
      return;
    }
    setSaving(true);
    const r = await updateLafHouseLocation({ ...parsed, radiusM: Math.round(Number(radius)) });
    setSaving(false);
    if (!r.ok) {
      toast.error(r.error ?? "Couldn't save the location.");
      return;
    }
    toast.success(parsed.lat === null ? "On-site check turned off." : "LAF House location saved.");
    await refetch();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">LAF House location</span>
        <span className="text-xs text-muted-foreground">
          Clock-ins and clock-outs within the radius are marked on-site; anywhere else is marked off-site with the address the phone was at. Nobody is
          stopped from clocking in.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 min-w-56 flex-1"
          placeholder="Latitude, longitude"
          value={coords}
          onChange={(e) => setCoords(e.target.value)}
          disabled={!canEdit}
          aria-label="LAF House latitude and longitude"
        />
        <div className="flex items-center gap-1.5 text-sm">
          <Input className="h-9 w-20" type="number" min={10} max={1000} value={radius} onChange={(e) => setRadius(e.target.value)} disabled={!canEdit} aria-label="Radius in metres" />
          m
        </div>
      </div>
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={useHere} disabled={locating}>
            <Crosshair className="size-3.5" />
            {locating ? "Finding…" : "Use my current location"}
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {parsed && parsed.lat !== null ? (
            <a
              className="flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              href={`https://www.openstreetmap.org/?mlat=${parsed.lat}&mlon=${parsed.lng}#map=19/${parsed.lat}/${parsed.lng}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MapPin className="size-3" />
              Check on the map
            </a>
          ) : null}
        </div>
      ) : null}
      {initial.lat === null ? <span className="text-xs text-amber-700 dark:text-amber-400">Not set yet: punches are not marked on-site or off-site.</span> : null}
    </div>
  );
}
