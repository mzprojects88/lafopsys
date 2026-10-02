"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bus, Car, CheckCircle2, Circle, Fuel, Plus, Truck, Wrench, X } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/context/role-provider";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { usePickups, type Pickup } from "@/lib/hooks/use-pickups-collection";
import { useHouseSheetPeople } from "@/lib/hooks/use-house-sheet-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { isActiveStay } from "@/lib/utils/beds";
import { useErrands, useVehicles, type Vehicle } from "@/lib/hooks/use-vehicles-collection";
import { OdometerDrums } from "@/components/modules/transport/odometer-drums";
import { TripControls, TripReadings } from "@/components/modules/transport/trip-controls";
import { ErrandCard, StartTripDialog, errandTitle } from "@/components/modules/transport/errands";
import { ExpenseDialog, ExpensesList } from "@/components/modules/transport/expenses";
import { formatKm } from "@/lib/utils/odometer";
import { formatDate, todayIso } from "@/lib/utils/date";
import { houseSheetPatientId, type HouseSheetPerson } from "@/lib/types/house-sheet";

const STATUS_LABEL = { scheduled: "Scheduled", in_progress: "On the road", completed: "Arrived" } as const;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }) : "");

/**
 * Transport (0053): pick-ups by LAF HOPE, the foundation's own vehicle. The
 * social worker builds each pick-up's manifest
 * from NCH's list; the driver, on a phone, ticks everyone on board, departs,
 * and marks the arrival. Check-in at the house then names the trip.
 * 0076: errands and hospital runs start here too, and once the Super Admin
 * sets a vehicle's starting odometer, every departure and arrival takes the
 * reading on the drums.
 */
export default function TransportPage() {
  const { staffId } = useRole();
  const access = useModuleAccess();
  const canEdit = access.canEdit("transport");
  // Building a manifest reads NCH's sheet, which is Patients data: drivers
  // tick, depart and arrive, but the social worker builds (0053).
  const canBuild = canEdit && access.canView("patients");
  const { pickups, loading } = usePickups();
  const { vehicles } = useVehicles();
  const { errands } = useErrands();
  const { staff } = useStaffRoster();
  const { roles } = useRole();
  const [creating, setCreating] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [logging, setLogging] = React.useState<{ vehicle: Vehicle; mode: "fuel" | "expense" } | null>(null);
  const activeVehicles = vehicles.filter((v) => v.active);
  const vehicleOf = (id: string | null) => vehicles.find((v) => v.id === id);

  const today = todayIso();
  const mineFirst = (a: { driverId: string | null }, b: { driverId: string | null }) => Number(b.driverId === staffId) - Number(a.driverId === staffId);
  const todays = pickups.filter((p) => p.date === today).sort(mineFirst);
  const todaysErrands = errands.filter((e) => e.date === today).sort(mineFirst);
  const upcoming = pickups.filter((p) => p.date > today).sort((a, b) => a.date.localeCompare(b.date));
  const earlier = pickups.filter((p) => p.date < today);
  const earlierErrands = errands.filter((e) => e.date < today);
  const driverName = (id: string | null) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "No driver yet";
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Transport"
        description="Pick-ups from NCH. The manifest comes from NCH's list; the driver ticks each family on board."
        action={
          canEdit || canBuild ? (
            <div className="flex flex-wrap gap-2">
              {canEdit && activeVehicles.length > 0 && (
                <Button variant={canBuild ? "outline" : "default"} onClick={() => setStarting(true)}>
                  <Car /> Start a trip
                </Button>
              )}
              {canBuild && (
                <Button onClick={() => setCreating(true)}>
                  <Plus /> New pick-up
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {activeVehicles.length > 0 && (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label="Vehicles">
          {activeVehicles.map((v) => (
            <VehicleOdometer key={v.id} vehicle={v} isSuperAdmin={roles.includes("admin")} onLog={canEdit ? (mode) => setLogging({ vehicle: v, mode }) : undefined} />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium text-foreground">Today · {formatDate(today)}</h2>
        {todays.length === 0 && todaysErrands.length === 0 && loading ? (
          <LoadingState rows={2} />
        ) : todays.length === 0 && todaysErrands.length === 0 ? (
          <EmptyState icon={Bus} title="No trip today" description={canBuild ? "Start one with New pick-up or Start a trip." : canEdit ? "Start one with Start a trip." : undefined} />
        ) : (
          <>
            {todays.map((p) => (
              <PickupCard key={p.id} pickup={p} vehicle={vehicleOf(p.vehicleId)} mine={p.driverId === staffId} driverName={driverName(p.driverId)} canEdit={canEdit} canBuild={canBuild} />
            ))}
            {todaysErrands.map((e) => (
              <ErrandCard key={e.id} errand={e} vehicle={vehicleOf(e.vehicleId)} mine={e.driverId === staffId} driverName={driverName(e.driverId)} canEdit={canEdit} />
            ))}
          </>
        )}
      </section>

      {upcoming.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-medium text-foreground">Coming up</h2>
          {upcoming.map((p) => (
            <PickupCard key={p.id} pickup={p} vehicle={vehicleOf(p.vehicleId)} mine={p.driverId === staffId} driverName={driverName(p.driverId)} canEdit={canEdit} canBuild={canBuild} />
          ))}
        </section>
      )}

      {(earlier.length > 0 || earlierErrands.length > 0) && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-medium text-foreground">Earlier this week</h2>
          <div className="divide-y divide-border rounded-2xl border border-border bg-card">
            {earlier.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                <span>
                  {formatDate(p.date, "EEE, MMM d")} · {p.departureTime} · {driverName(p.driverId)}
                </span>
                <span className="text-theme-xs text-muted-foreground">
                  {p.manifest.filter((m) => m.boardedAt).length} of {p.manifest.length} on board · {STATUS_LABEL[p.status]}
                  {p.arrivedAt ? ` ${time(p.arrivedAt)}` : ""}
                  {p.odometerStart != null && p.odometerEnd != null ? ` · ${formatKm(p.odometerEnd - p.odometerStart)}` : ""}
                </span>
              </div>
            ))}
            {earlierErrands.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-theme-sm">
                <span>
                  {formatDate(e.date, "EEE, MMM d")} · {errandTitle(e)} · {driverName(e.driverId)}
                </span>
                <span className="text-theme-xs text-muted-foreground">
                  {STATUS_LABEL[e.status]}
                  {e.odometerStart != null && e.odometerEnd != null ? ` · ${formatKm(e.odometerEnd - e.odometerStart)}` : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <ExpensesList vehicles={vehicles} />

      {creating && <NewPickupDialog onClose={() => setCreating(false)} />}
      {logging && <ExpenseDialog vehicle={logging.vehicle} mode={logging.mode} onClose={() => setLogging(null)} />}
      {starting && <StartTripDialog vehicles={activeVehicles} onClose={() => setStarting(false)} />}
    </div>
  );
}

/** Each vehicle's odometer on the drums (or how tracking starts), and its fuel and expense buttons. */
function VehicleOdometer({ vehicle: v, isSuperAdmin, onLog }: { vehicle: Vehicle; isSuperAdmin: boolean; onLog?: (mode: "fuel" | "expense") => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-foreground">{v.name}</span>
            <span className="text-theme-xs text-muted-foreground">
              {v.plateNo ?? "No plate number yet"}
              {v.startOdometer == null ? " · odometer not tracked yet" : ""}
            </span>
            {v.startOdometer == null && isSuperAdmin && (
              <Link href="/settings#vehicles" className="text-theme-xs text-primary hover:underline">
                Set the starting odometer to start tracking
              </Link>
            )}
          </div>
          {v.startOdometer != null && <OdometerDrums value={v.lastReading} />}
        </div>
        {onLog && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => onLog("fuel")}>
              <Fuel /> Log fuel
            </Button>
            <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => onLog("expense")}>
              <Wrench /> Log expense
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PickupCard({ pickup: p, vehicle, mine, driverName, canEdit, canBuild }: { pickup: Pickup; vehicle: Vehicle | undefined; mine: boolean; driverName: string; canEdit: boolean; canBuild: boolean }) {
  const { setBoarded, removeFromManifest, addToManifest } = usePickups();
  const candidates = useManifestCandidates(p.date);
  const [busy, setBusy] = React.useState<string | null>(null);
  const boarded = p.manifest.filter((m) => m.boardedAt).length;
  const open = p.status !== "completed";
  const addable = candidates.filter((c) => !p.manifest.some((m) => m.sheetRowId === c.id));

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "Something went wrong.");
    else if (ok) toast.success(ok);
  }

  return (
    <Card className={mine ? "border-primary/50" : undefined}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div className="flex flex-col">
          <CardTitle className="flex items-center gap-2 text-base">
            <Truck className="size-4 text-muted-foreground" />
            Pick-up {p.departureTime}
            {mine && <Badge>Your trip</Badge>}
          </CardTitle>
          <span className="text-theme-xs text-muted-foreground">
            {formatDate(p.date, "EEE, MMM d")} · {driverName} · {boarded} of {p.manifest.length} on board
            {p.departedAt ? ` · left ${time(p.departedAt)}` : ""}
            {p.arrivedAt ? ` · arrived ${time(p.arrivedAt)}` : ""}
          </span>
        </div>
        <StatusBadge domain="trip" status={p.status} label={STATUS_LABEL[p.status]} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {p.manifest.map((m) => {
          const on = !!m.boardedAt;
          return (
            <div key={m.id} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canEdit || !open || busy === m.id}
                onClick={() => run(m.id, () => setBoarded(m.id, !on))}
                className="flex min-h-12 flex-1 items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-80 aria-pressed:border-success/30 aria-pressed:bg-success/12 dark:aria-pressed:bg-success/15"
                aria-pressed={on}
                aria-label={`${m.name}: ${on ? "on board, tap to undo" : "tap when on board"}`}
              >
                {on ? <CheckCircle2 className="size-6 shrink-0 text-success-foreground dark:text-success" /> : <Circle className="size-6 shrink-0 text-muted-foreground" />}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{m.name}</span>
                  <span className="truncate text-theme-xs text-muted-foreground">
                    {m.carerName ? `with ${m.carerName}` : "carer not on the sheet"}
                    {on ? ` · on board ${time(m.boardedAt)}` : ""}
                  </span>
                </span>
              </button>
              {canBuild && p.status === "scheduled" && !on && (
                <Button size="icon" variant="ghost" aria-label={`Take ${m.name} off this trip`} disabled={busy === m.id} onClick={() => run(m.id, () => removeFromManifest(m.id))}>
                  <X className="size-4" />
                </Button>
              )}
            </div>
          );
        })}

        {canBuild && open && addable.length > 0 && (
          <Select value="" onValueChange={(id) => {
            const row = addable.find((c) => c.id === id);
            if (row) void run("add", () => addToManifest(p.id, row), `${row.patientName} added`);
          }}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Add a name from NCH's list">
              <SelectValue placeholder="Add a name from NCH's list…" />
            </SelectTrigger>
            <SelectContent>
              {addable.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.patientName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <TripReadings trip={p} />
        <TripControls trip={p} vehicle={vehicle} canEdit={canEdit} canDepart={boarded > 0} departLabel={`Depart with ${boarded}`} arriveLabel="Arrived at LAF House" route="pickup" />
        {p.status === "completed" && (
          <p className="text-theme-xs text-muted-foreground">
            Check the families in on the{" "}
            <Link href="/patients/house-sheet" className="text-primary hover:underline">
              House Sheet
            </Link>
            ; LAF HOPE and this trip are filled in for those on board.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Names on NCH's sheet that day who are not in the house yet and not on another open pick-up. */
function useManifestCandidates(date: string): HouseSheetPerson[] {
  const { people } = useHouseSheetPeople();
  const { stays } = usePatientsData();
  const { pickups } = usePickups();
  const inHouse = new Set(stays.filter(isActiveStay).map((s) => s.patientId));
  const taken = new Set(pickups.filter((p) => p.date === date && p.status !== "completed").flatMap((p) => p.manifest.map((m) => m.sheetRowId)));
  return people.filter((p) => {
    if (p.offSheetAt !== null || p.matchStatus === "dismissed" || taken.has(p.id)) return false;
    const pid = houseSheetPatientId(p);
    return !(pid && inHouse.has(pid));
  });
}

function NewPickupDialog({ onClose }: { onClose: () => void }) {
  const { createPickup } = usePickups();
  const { staff } = useStaffRoster();
  const [date, setDate] = React.useState(todayIso());
  const [departure, setDeparture] = React.useState("18:00"); // LAF staff pick up at 6 PM (Important Notes)
  const [driverId, setDriverId] = React.useState("");
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const candidates = useManifestCandidates(date);
  // Main role or an additional one (0073): an inventory staff member may also drive.
  const drivers = staff.filter((s) => s.active && (s.role === "driver" || s.extraRoles.includes("driver")));

  function toggle(id: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const r = await createPickup({ date, departureTime: departure, driverId: driverId || null, sheetRowIds: [...picked] });
    setSaving(false);
    if (!r.ok) {
      toast.error(`Couldn't create the pick-up: ${r.error}`);
      return;
    }
    toast.success("Pick-up ready for the driver");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New pick-up</DialogTitle>
          <DialogDescription>Choose who to bring from NCH. The driver sees this manifest on their phone.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="pickupDate">Day</FieldLabel>
            <Input id="pickupDate" type="date" min={todayIso()} value={date} onChange={(e) => { setDate(e.target.value); setPicked(new Set()); }} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pickupTime">Leaves LAF House</FieldLabel>
            <Input id="pickupTime" type="time" value={departure} onChange={(e) => setDeparture(e.target.value)} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="pickupDriver">Driver</FieldLabel>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger id="pickupDriver" className="w-full">
              <SelectValue placeholder={drivers.length ? "Select the driver" : "No driver accounts"} />
            </SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.firstName} {d.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel>From NCH&apos;s list</FieldLabel>
          {candidates.length === 0 ? (
            <FieldDescription>Nobody on NCH&apos;s sheet is waiting for a ride.</FieldDescription>
          ) : (
            <div className="flex flex-col gap-1.5">
              {candidates.map((c) => (
                <label key={c.id} className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 py-2 text-theme-sm">
                  <Checkbox checked={picked.has(c.id)} onCheckedChange={(v) => toggle(c.id, !!v)} />
                  <span className="flex flex-col">
                    <span className="font-medium">{c.patientName}</span>
                    {c.carerName && <span className="text-theme-xs text-muted-foreground">with {c.carerName}</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={picked.size === 0 || !departure || saving} onClick={save}>
            {saving ? "Saving…" : `Create with ${picked.size}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
