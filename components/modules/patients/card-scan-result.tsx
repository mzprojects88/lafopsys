"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BedDouble, Bus, Check, Minus, Plus, TriangleAlert, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { plainError } from "@/lib/utils/plain-error";
import { formatDate } from "@/lib/utils/date";
import { formatTime12 } from "@/lib/utils/time12";
import { MEALS, type Meal } from "@/lib/hooks/use-meals-served";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { CheckInDialog } from "@/components/modules/patients/check-in-dialog";
import { TransferBedDialog } from "@/components/modules/patients/transfer-bed-dialog";
import { MoveTonightDialog } from "@/components/modules/patients/house-today";
import { cn } from "@/lib/utils";

export { cardToken } from "@/lib/utils/card-token";

interface ScanTrip {
  id: string;
  direction: "to_hospital" | "from_hospital";
  status: "scheduled" | "in_progress";
  departureTime: string | null;
  driver: string | null;
  mine: boolean;
  passengers: number;
  onBoard: boolean;
}

interface Scan {
  status: "active" | "replaced" | "switched_off" | "unknown";
  version?: number;
  name?: string;
  initials?: string;
  carer?: { name: string; relationship: string | null } | null;
  hasPhoto?: boolean;
  inHouse?: boolean;
  canContinue?: boolean;
  today?: string;
  mealsBackDays?: number;
  meals?: { date: string; meal: Meal }[];
  canHousing?: boolean;
  canMeal?: boolean;
  canTransport?: boolean;
  trips?: ScanTrip[];
  patientId?: string | null;
  caseNumber?: string | null;
  bed?: string | null;
  lastBed?: string | null;
  night?: number | null;
  endedAt?: string;
  endedReason?: string | null;
  newerVersion?: number | null;
}

type Service = "housing" | "meals" | "transport";
const MEAL_LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const DIRECTION: Record<ScanTrip["direction"], string> = { from_hospital: "NCH → LAF (pick-up)", to_hospital: "LAF → NCH (drop-off)" };
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * A scanned Patient ID card (0165, 0166): the child, then the service they received -- Housing (tonight's
 * bed), Meals (a day and breakfast, lunch or dinner) or Transport (a passenger of an open trip today).
 * Each person sees only the services their role may record; the database checks every step again.
 */
export function CardScanResult({ token }: { token: string }) {
  const [scan, setScan] = React.useState<Scan | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [service, setService] = React.useState<Service | null>(null);
  const [mealDay, setMealDay] = React.useState<string | null>(null);
  const [people, setPeople] = React.useState(2);
  const [dialog, setDialog] = React.useState<"another" | "checkin" | "change" | null>(null);
  const { patients, stays } = usePatientsData();

  const load = React.useCallback(async () => {
    const { data, error: e } = await createClient().schema("ops").rpc("scan_card", { p_token: token });
    if (e) setError(plainError(e.message));
    else setScan(data as Scan);
  }, [token]);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the scan is read once per card; load() sets state when the answer arrives
    void load();
  }, [load]);

  async function rpc(key: string, name: string, args: Record<string, unknown>, done: (data: unknown) => string) {
    setBusy(key);
    const { data, error: e } = await createClient().schema("ops").rpc(name, { p_token: token, ...args });
    setBusy(null);
    if (e) return void toast.error(plainError(e.message));
    toast.success(done(data));
    await load();
  }
  const logAdmission = (detail: string) => void createClient().schema("ops").rpc("log_card_scan", { p_token: token, p_purpose: "admission", p_detail: detail });

  if (error) return <Notice title="This card could not be read" text={error} />;
  if (!scan) return <p className="py-6 text-center text-theme-sm text-muted-foreground">Reading the card…</p>;
  if (scan.status === "unknown") return <Notice title="Not an LAF card" text="This code is not a Patient ID card ArkOS knows. Check the card or look the child up by name." />;
  if (scan.status !== "active") {
    return (
      <Notice
        title={`${scan.name ?? "This card"}: card ${scan.version} no longer works`}
        text={`${scan.status === "replaced" ? "It was replaced" : "It was switched off"}${scan.endedAt ? ` on ${formatDate(scan.endedAt)}` : ""}${scan.endedReason ? ` (${scan.endedReason})` : ""}.${scan.newerVersion ? ` Card ${scan.newerVersion} is the one to use.` : ""} Please take this card back.`}
      />
    );
  }

  const today = scan.today ?? "";
  const day = mealDay ?? today;
  const oldest = addDays(today, -(scan.mealsBackDays ?? 0));
  const mealsOn = (d: string) => (scan.meals ?? []).filter((m) => m.date === d).map((m) => m.meal);
  const services = ([
    ["housing", "Housing", BedDouble, scan.canHousing],
    ["meals", "Meals", Utensils, scan.canMeal],
    ["transport", "Transport", Bus, scan.canTransport],
  ] as const).filter(([, , , allowed]) => allowed);
  const chosen = service ?? (services.length === 1 ? services[0]![0] : null);
  const patient = scan.patientId ? patients.find((p) => p.id === scan.patientId) : undefined;
  const lastNight = scan.patientId
    ? stays.filter((s) => s.patientId === scan.patientId && s.checkOutReason === "daily_reset" && s.checkOutAt === today).sort((a, b) => b.checkInAt.localeCompare(a.checkInAt))[0]
    : undefined;
  const tonight = scan.patientId ? stays.find((s) => s.patientId === scan.patientId && (s.status === "in_house" || s.status === "overdue")) : undefined;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start gap-4">
        <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-2xl font-semibold text-primary">
          {scan.hasPhoto ? <img src={`/api/cards/photo?token=${token}`} alt="The child's photo" width={80} height={96} className="h-full w-full object-cover" /> : scan.initials}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-lg font-semibold leading-tight">{scan.name}</span>
          {scan.caseNumber ? <span className="text-theme-xs font-medium text-muted-foreground">{scan.caseNumber}</span> : null}
          {scan.carer ? (
            <span className="text-theme-sm">
              Carer: <b>{scan.carer.name}</b>
              {scan.carer.relationship ? ` · ${scan.carer.relationship}` : ""}
            </span>
          ) : null}
          <span className="text-theme-xs text-muted-foreground">
            Card {scan.version}
            {scan.inHouse ? ` · in the house tonight${scan.bed ? `, bed ${scan.bed}` : ""}` : scan.canContinue ? " · stayed last night" : " · not checked in"}
          </span>
        </div>
      </div>

      {services.length > 1 ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${services.length}, minmax(0, 1fr))` }} role="group" aria-label="Which service">
          {services.map(([key, label, Icon]) => (
            <Button key={key} variant={chosen === key ? "default" : "outline"} className="h-14 flex-col gap-1" onClick={() => setService(key)}>
              <Icon className="size-5" />
              {label}
            </Button>
          ))}
        </div>
      ) : null}
      {services.length === 0 ? <p className="text-theme-sm text-muted-foreground">Your role records none of these services.</p> : null}

      {chosen === "housing" ? (
        <div className="flex flex-col gap-2">
          {scan.inHouse ? (
            <>
              <p className="text-theme-sm">In the house tonight{scan.bed ? `, bed ${scan.bed}` : ""}.</p>
              {tonight ? (
                <Button variant="outline" className="w-fit" onClick={() => setDialog("change")}>
                  Change bed
                </Button>
              ) : null}
            </>
          ) : scan.canContinue ? (
            <>
              <Button className="gap-1.5" disabled={busy !== null} onClick={() => void rpc("same", "readmit_by_card", {}, () => `${scan.name}: same bed as last night.`)}>
                <BedDouble className="size-4" />
                Same bed as last night{scan.lastBed ? ` (${scan.lastBed})` : ""}
                {scan.night ? <span className="font-normal opacity-80">· night {scan.night}</span> : null}
              </Button>
              {lastNight ? (
                <Button variant="outline" disabled={busy !== null} onClick={() => setDialog("another")}>
                  Another bed tonight
                </Button>
              ) : null}
            </>
          ) : patient ? (
            <Button className="gap-1.5" onClick={() => setDialog("checkin")}>
              <BedDouble className="size-4" />
              Check in (admission)
            </Button>
          ) : (
            <p className="text-theme-sm text-muted-foreground">Open the child&apos;s record to check them in.</p>
          )}
        </div>
      ) : null}

      {chosen === "meals" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[today, addDays(today, -1)].map((d, i) => (
              <Button key={d} size="sm" variant={day === d ? "default" : "outline"} onClick={() => setMealDay(d)}>
                {i === 0 ? "Today" : "Yesterday"}
              </Button>
            ))}
            <Input
              type="date"
              aria-label="Another day"
              className="w-40"
              min={oldest}
              max={today}
              value={day}
              onChange={(e) => e.target.value && setMealDay(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {MEALS.map((m) => {
              const done = mealsOn(day).includes(m);
              return (
                <Button
                  key={m}
                  variant={done ? "secondary" : "default"}
                  disabled={done || busy !== null}
                  className="h-12 gap-1"
                  onClick={() =>
                    void rpc(m, "record_meal_by_card", { p_meal: m, p_date: day }, (d) =>
                      (d as { added?: boolean })?.added ? `${MEAL_LABEL[m]} on ${formatDate(day)} recorded for ${scan.name}.` : `${MEAL_LABEL[m]} on ${formatDate(day)} was already recorded.`
                    )
                  }
                >
                  {done ? <Check className="size-4" /> : null}
                  {MEAL_LABEL[m]}
                </Button>
              );
            })}
          </div>
          <p className="text-theme-xs text-muted-foreground">{formatDate(day)} · meals can be recorded up to {scan.mealsBackDays} days back.</p>
        </div>
      ) : null}

      {chosen === "transport" ? (
        <div className="flex flex-col gap-3">
          {(scan.trips ?? []).length === 0 ? (
            <p className="text-theme-sm text-muted-foreground">
              No scheduled or started trip today{scan.canHousing ? "" : " that you drive"}. Open the trip in Transport first, then scan again.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-3 text-theme-sm">
                People riding
                <Button size="icon" variant="outline" aria-label="One fewer" disabled={people <= 1} onClick={() => setPeople((n) => n - 1)}>
                  <Minus className="size-4" />
                </Button>
                <b className="w-4 text-center">{people}</b>
                <Button size="icon" variant="outline" aria-label="One more" disabled={people >= 6} onClick={() => setPeople((n) => n + 1)}>
                  <Plus className="size-4" />
                </Button>
                <span className="text-theme-xs text-muted-foreground">child and carer = 2</span>
              </div>
              {(scan.trips ?? []).map((t) => (
                <div key={t.id} className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2", t.mine ? "border-primary/40" : "border-border")}>
                  <div className="flex flex-col">
                    <span className="text-theme-sm font-medium">{DIRECTION[t.direction]}</span>
                    <span className="text-theme-xs text-muted-foreground">
                      {[t.departureTime ? formatTime12(t.departureTime) : null, t.driver ? `driver ${t.driver}` : null, t.status === "in_progress" ? "on the road" : "scheduled", `${t.passengers} on board`].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {t.onBoard ? (
                    <span className="flex items-center gap-1 text-theme-sm font-medium text-success-foreground dark:text-success">
                      <Check className="size-4" /> On this trip
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void rpc(t.id, "add_passenger_by_card", { p_trip_id: t.id, p_people: people }, () => `${scan.name}: on the trip ${DIRECTION[t.direction]}.`)}
                    >
                      Add as passenger
                    </Button>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}

      {scan.patientId ? (
        <Link href={`/patients/${scan.patientId}`} className="text-theme-sm font-medium text-primary hover:underline">
          Open the child&apos;s record
        </Link>
      ) : null}

      {dialog === "another" && lastNight ? (
        <MoveTonightDialog
          stay={lastNight}
          name={scan.name ?? ""}
          from={scan.lastBed ?? "—"}
          title={`Tonight's bed for ${scan.name}`}
          cta="Give this bed"
          busy={busy !== null}
          onClose={() => setDialog(null)}
          onMove={async (unitId, exceptionReason) => {
            await rpc("another", "readmit_by_card", { p_unit_id: unitId, p_exception_reason: exceptionReason }, () => "Bed given for tonight.");
            setDialog(null);
          }}
        />
      ) : null}
      {patient ? (
        <CheckInDialog
          key={dialog === "checkin" ? "scan-check-in-open" : "scan-check-in-closed"}
          target={dialog === "checkin" ? { patient } : null}
          onOpenChange={(open) => !open && setDialog(null)}
          onCheckedIn={() => {
            logAdmission("checked in");
            setDialog(null);
            void load();
          }}
        />
      ) : null}
      {dialog === "change" && tonight ? (
        <TransferBedDialog
          stay={tonight}
          patientName={scan.name ?? ""}
          onOpenChange={(open) => !open && setDialog(null)}
          onTransferred={() => {
            logAdmission("changed bed");
            setDialog(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div role="alert" className="flex gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
      <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="flex flex-col gap-1">
        <span className="font-semibold">{title}</span>
        <span className="text-theme-sm text-muted-foreground">{text}</span>
      </div>
    </div>
  );
}
