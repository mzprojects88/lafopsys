"use client";

import * as React from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlaceMap, type MapPoint } from "@/components/patterns/place-map";
import { useAppSettings } from "@/lib/hooks/use-app-settings";
import { useRole } from "@/lib/rbac/use-role";
import { updateTransportPlaces } from "@/app/(app)/settings/actions";
import { estimateRoadKm, parseCoords, type Place } from "@/lib/utils/places";

type Row = { name: string; coords: string };

/**
 * Places trips go to (0123): a name and its pin. A trip whose destination matches a name shows
 * the pin, a Google Maps directions link and an estimate of the km. Pin a place by pasting
 * coordinates from Google Maps (long-press the spot; the numbers show at the top) or a Maps link,
 * or by choosing the row and clicking the map.
 */
export function TransportPlacesField() {
  const { transportPlaces, lafHouse, loading } = useAppSettings();
  if (loading) return null;
  return <TransportPlacesForm key={JSON.stringify(transportPlaces)} initial={transportPlaces} home={lafHouse.lat != null && lafHouse.lng != null ? { lat: lafHouse.lat, lng: lafHouse.lng } : null} />;
}

function TransportPlacesForm({ initial, home }: { initial: Place[]; home: { lat: number; lng: number } | null }) {
  const { refetch } = useAppSettings();
  const { role } = useRole();
  const canEdit = role === "admin";
  const [rows, setRows] = React.useState<Row[]>(() => (initial.length ? initial.map((p) => ({ name: p.name, coords: `${p.lat}, ${p.lng}` })) : [{ name: "National Children's Hospital", coords: "" }]));
  const [active, setActive] = React.useState(0);
  const [saving, setSaving] = React.useState(false);

  const parsed = rows.map((r) => ({ ...r, at: parseCoords(r.coords) }));
  const points: MapPoint[] = [
    ...(home ? [{ ...home, label: "LAF House", kind: "home" as const }] : []),
    ...parsed.flatMap((r) => (r.at && r.name.trim() ? [{ ...r.at, label: r.name.trim(), kind: "place" as const }] : [])),
  ];
  const set = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    const bad = parsed.find((r) => r.name.trim() && r.coords.trim() && !r.at);
    if (bad) return void toast.error(`"${bad.name}": write the pin as "latitude, longitude" (two numbers, as Google Maps copies them) or paste a Google Maps link.`);
    const places = parsed.filter((r) => r.name.trim() && r.at).map((r) => ({ name: r.name.trim(), lat: r.at!.lat, lng: r.at!.lng }));
    setSaving(true);
    const result = await updateTransportPlaces(places);
    setSaving(false);
    if (!result.ok) return void toast.error(result.error ?? "Couldn't save the places.");
    toast.success(`${places.length} place${places.length === 1 ? "" : "s"} saved.`);
    await refetch();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Places trips go to</span>
        <span className="text-xs text-muted-foreground">
          A trip to one of these shows its pin, a Google Maps directions link and an estimate of the km. Paste the coordinates from Google Maps (long-press the spot; the numbers show at the top) or a Maps link, or choose a row and click the map.
          {home ? "" : " LAF House is not pinned yet: set it under Attendance Policy."}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {parsed.map((r, i) => (
          <div key={i} className={`grid grid-cols-1 gap-2 rounded-xl border p-2 sm:grid-cols-[1fr_1fr_auto] ${i === active ? "border-primary/60" : "border-border"}`} onFocus={() => setActive(i)} onClick={() => setActive(i)}>
            <Input aria-label="Place name" value={r.name} maxLength={80} disabled={!canEdit} placeholder="e.g. National Children's Hospital" onChange={(e) => set(i, { name: e.target.value })} />
            <Input aria-label={`Pin of ${r.name || "this place"}`} value={r.coords} maxLength={300} disabled={!canEdit} placeholder="latitude, longitude (or a Google Maps link)" onChange={(e) => set(i, { coords: e.target.value })} />
            <div className="flex items-center gap-2">
              <span className="text-xs whitespace-nowrap text-muted-foreground">{r.at && home ? `about ${estimateRoadKm(home, r.at)} km` : r.coords.trim() && !r.at ? "not a pin" : ""}</span>
              {canEdit ? (
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${r.name || "this place"}`} onClick={() => { setRows((prev) => prev.filter((_, j) => j !== i)); setActive(0); }}>
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <PlaceMap points={points} onPick={canEdit && rows[active] ? (at) => set(active, { coords: `${at.lat}, ${at.lng}` }) : undefined} />
      {canEdit ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { setRows((prev) => [...prev, { name: "", coords: "" }]); setActive(rows.length); }}>
            <Plus /> Add a place
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save places"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
