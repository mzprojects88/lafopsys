"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Bus, Car, CheckCircle2, Circle, Fuel, Pencil, Plus, Truck, UserPlus, Wrench, X } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { LoadingState } from "@/components/patterns/loading-state";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/context/role-provider";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { usePickups, type ManifestEntry, type Pickup } from "@/lib/hooks/use-pickups-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useErrands, useVehicles, type Vehicle } from "@/lib/hooks/use-vehicles-collection";
import { OdometerDrums } from "@/components/modules/transport/odometer-drums";
import { TripControls, TripReadings } from "@/components/modules/transport/trip-controls";
import { ErrandCard, StartTripDialog, errandTitle } from "@/components/modules/transport/errands";
import { ExpenseDialog, ExpensesList } from "@/components/modules/transport/expenses";
import { NewTripDialog, useManifestCandidates, usePatientsInHouse } from "@/components/modules/transport/new-trip-dialog";
import { TRANSPORT_SUB_NAV } from "@/components/modules/transport/transport-nav";
import { ModuleSubNav } from "@/components/patterns/module-subnav";
import { formatTime12 } from "@/lib/utils/time12";
import { formatKm, routeKey } from "@/lib/utils/odometer";
import { tripWords } from "@/lib/utils/trip-direction";
import { plainError } from "@/lib/utils/plain-error";
import { formatDate, todayIso } from "@/lib/utils/date";

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
  // An urgent call first (0097), then the viewer's own trips.
  const todays = pickups.filter((p) => p.date === today).sort((a, b) => Number(b.urgent) - Number(a.urgent) || mineFirst(a, b));
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
        description="Pick-ups to LAF House and deliveries to the hospital. The driver ticks each family on board and can add a passenger."
        action={
          <div className="flex flex-wrap gap-2">
            <ModuleSubNav items={TRANSPORT_SUB_NAV} />
            {canEdit && activeVehicles.length > 0 && (
              <Button variant={canBuild ? "outline" : "default"} onClick={() => setStarting(true)}>
                <Car /> Start a trip
              </Button>
            )}
            {canBuild && (
              <Button onClick={() => setCreating(true)}>
                <Plus /> New trip
              </Button>
            )}
          </div>
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
          <EmptyState icon={Bus} title="No trip today" description={canBuild ? "Plan one with New trip, or Start a trip for an errand." : canEdit ? "Start one with Start a trip." : undefined} />
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
                  {formatDate(p.date, "EEE, MMM d")} · {tripWords(p.direction).short} {formatTime12(p.departureTime)} · {driverName(p.driverId)}
                </span>
                <span className="text-theme-xs text-muted-foreground">
                  {p.manifest.filter((m) => m.boardedAt).length} of {p.manifest.length} on board · {STATUS_LABEL[p.status]}
                  {p.arrivedAt ? ` ${time(p.arrivedAt)}` : ""}
                  {p.odometerStart != null && p.odometerEnd != null ? ` · ${formatKm(p.odometerEnd - p.odometerStart)}` : ""}
                  {" · "}
                  <Link href={`/transport/manifest/${p.id}`} target="_blank" className="text-primary hover:underline">
                    Print manifest
                  </Link>
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

      {creating && <NewTripDialog vehicles={activeVehicles} onClose={() => setCreating(false)} />}
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
  // A passenger added or corrected by the driver or the social worker (0096); null = closed.
  const [passenger, setPassenger] = React.useState<ManifestEntry | "new" | null>(null);
  const words = tripWords(p.direction);
  const pickup = p.direction === "from_hospital";
  const boarded = p.manifest.filter((m) => m.boardedAt).length;
  const open = p.status !== "completed";
  const addable = pickup ? candidates.filter((c) => !p.manifest.some((m) => m.sheetRowId === c.id)) : [];

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) toast.error(r.error ?? "Something went wrong.");
    else if (ok) toast.success(ok);
  }

  return (
    <Card className={p.urgent && p.status !== "completed" ? "border-destructive/60" : mine ? "border-primary/50" : undefined}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Truck className="size-4 text-muted-foreground" />
            {words.short} {formatTime12(p.departureTime)}
            <Badge variant="outline">{words.long}</Badge>
            {p.urgent && <Badge variant="destructive">Urgent</Badge>}
            {mine && <Badge>Your trip</Badge>}
          </CardTitle>
          <span className="text-theme-xs text-muted-foreground">
            {formatDate(p.date, "EEE, MMM d")} · {driverName} · {boarded} of {p.manifest.length} on board
            {p.destination ? ` · to ${p.destination}` : ""}
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
                    {m.carerName ? `with ${m.carerName}` : "no carer named"}
                    {m.note ? ` · ${m.note}` : ""}
                    {on ? ` · on board ${time(m.boardedAt)}` : ""}
                  </span>
                </span>
              </button>
              {canEdit && open && (
                <Button size="icon" variant="ghost" aria-label={`Correct ${m.name}`} disabled={busy === m.id} onClick={() => setPassenger(m)}>
                  <Pencil className="size-4" />
                </Button>
              )}
              {canEdit && p.status === "scheduled" && !on && (
                <Button size="icon" variant="ghost" aria-label={`Take ${m.name} off this trip`} disabled={busy === m.id} onClick={() => run(m.id, () => removeFromManifest(m.id))}>
                  <X className="size-4" />
                </Button>
              )}
            </div>
          );
        })}

        {open && (canEdit || addable.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {canBuild && addable.length > 0 && (
              <Select
                value=""
                onValueChange={(id) => {
                  const row = addable.find((c) => c.id === id);
                  if (row) void run("add", () => addToManifest(p.id, row), `${row.patientName} added`);
                }}
              >
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
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setPassenger("new")}>
                <UserPlus /> Add a passenger
              </Button>
            )}
          </div>
        )}

        <TripReadings trip={p} />
        <Link href={`/transport/manifest/${p.id}`} target="_blank" className="text-theme-xs text-primary hover:underline">
          Print manifest
        </Link>
        <TripControls
          trip={p}
          vehicle={vehicle}
          canEdit={canEdit}
          canDepart={boarded > 0}
          departLabel={`Depart with ${boarded}`}
          arriveLabel={words.arrived}
          route={routeKey(p.direction, p.destination)}
        />
        {p.status === "completed" && pickup && (
          <p className="text-theme-xs text-muted-foreground">
            Check the families in on the{" "}
            <Link href="/patients/house-sheet" className="text-primary hover:underline">
              House Sheet
            </Link>
            ; LAF HOPE and this trip are filled in for those on board.
          </p>
        )}
      </CardContent>
      {passenger && <PassengerDialog trip={p} entry={passenger === "new" ? null : passenger} onClose={() => setPassenger(null)} />}
    </Card>
  );
}

const TYPED = "typed";

/** Adds a passenger (a child in the house or a typed name) or corrects one, until the trip arrives (0096). */
function PassengerDialog({ trip, entry, onClose }: { trip: Pickup; entry: ManifestEntry | null; onClose: () => void }) {
  const { addPassenger, updatePassenger } = usePickups();
  const inHouse = usePatientsInHouse().filter((c) => !trip.manifest.some((m) => m.patientId === c.id));
  const [patientId, setPatientId] = React.useState<string>(TYPED);
  const [name, setName] = React.useState(entry?.name ?? "");
  const [carer, setCarer] = React.useState(entry?.carerName ?? "");
  const [note, setNote] = React.useState(entry?.note ?? "");
  const [saving, setSaving] = React.useState(false);
  const typed = entry !== null || patientId === TYPED;
  const chosenName = typed ? name.trim() : (inHouse.find((c) => c.id === patientId)?.name ?? "");

  async function save() {
    setSaving(true);
    const fields = { name: chosenName, carerName: carer.trim() || null, note: note.trim() || null };
    const r = entry ? await updatePassenger(entry.id, fields) : await addPassenger(trip.id, { ...fields, patientId: typed ? null : patientId });
    setSaving(false);
    if (!r.ok) {
      toast.error(plainError(r.error));
      return;
    }
    toast.success(entry ? "Passenger corrected" : `${chosenName} added`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "Correct a passenger" : "Add a passenger"}</DialogTitle>
          <DialogDescription>
            {tripWords(trip.direction).long}, {formatTime12(trip.departureTime)}. Changes are allowed until the trip arrives.
          </DialogDescription>
        </DialogHeader>
        {!entry && (
          <Field>
            <FieldLabel htmlFor="passengerWho">Who</FieldLabel>
            <Select value={patientId} onValueChange={setPatientId}>
              <SelectTrigger id="passengerWho" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TYPED}>Type a name</SelectItem>
                {inHouse.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Children in the house now, or type the name of someone else.</FieldDescription>
          </Field>
        )}
        {typed && (
          <Field>
            <FieldLabel htmlFor="passengerName">Child&apos;s name</FieldLabel>
            <Input id="passengerName" value={name} maxLength={120} placeholder="Last name, first name" onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="passengerCarer">Carer (optional)</FieldLabel>
          <Input id="passengerCarer" value={carer} maxLength={120} onChange={(e) => setCarer(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="passengerNote">Note (optional)</FieldLabel>
          <Input id="passengerNote" value={note} maxLength={200} placeholder="e.g. chemo at 9:00 AM, wheelchair" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!chosenName || saving} onClick={save}>
            {saving ? "Saving…" : entry ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

