"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Car, CircleCheck, Paperclip, Receipt, Undo2, Wallet } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { FileLibrary } from "@/components/patterns/file-library";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useArrivalRides } from "@/lib/hooks/use-arrival-rides-collection";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { useStaffRoster } from "@/lib/hooks/use-staff-roster";
import { useAllFiles } from "@/lib/hooks/use-files-collection";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { ARRIVAL_APP_LABELS } from "@/lib/utils/arrival";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import type { ArrivalRide } from "@/lib/types/patient";

/**
 * Families who came to the house by a ride app (0052): one row per booking,
 * with its fare, receipt, and whether LAF pays it back -- two or more NCH
 * patients in one car, never an Angkas. The database holds the rule; this
 * page shows it and records the pay-out.
 */
export default function RidesPage() {
  const { rides, loading, setFare, markReimbursed, undoReimbursed } = useArrivalRides();
  const { patients, stays, carers } = usePatientsData();
  const { staff } = useStaffRoster();
  const { files } = useAllFiles();
  const canEdit = useModuleAccess().canEdit("patients");
  const [tab, setTab] = React.useState<"due" | "all">("due");
  const [receiptFor, setReceiptFor] = React.useState<ArrivalRide | null>(null);
  const [payFor, setPayFor] = React.useState<ArrivalRide | null>(null);
  const [fareFor, setFareFor] = React.useState<ArrivalRide | null>(null);

  const due = rides.filter((r) => r.reimbursable && !r.reimbursedAt);
  const month = todayIso().slice(0, 7);
  const paidThisMonth = rides.filter((r) => r.reimbursedAt?.startsWith(month)).reduce((sum, r) => sum + (r.reimbursedAmount ?? 0), 0);
  const shown = tab === "due" ? due : rides;

  const ridersOf = (rideId: string) =>
    stays.filter((s) => s.arrivalRideId === rideId).map((s) => ({ stay: s, patient: patients.find((p) => p.id === s.patientId) }));
  const receipts = (rideId: string) => files.filter((f) => f.recordType === "ride" && f.recordId === rideId && f.status === "ready").length;
  const staffName = (id?: string) => {
    const s = staff.find((x) => x.id === id);
    return s ? `${s.firstName} ${s.lastName}` : "—";
  };
  const whyNot = (r: ArrivalRide) => (r.app === "angkas" ? "Angkas is never reimbursed" : `${r.riders} famil${r.riders === 1 ? "y" : "ies"} — needs 2 or more`);

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Arrival Rides"
        description="Ride-app bookings that brought families to LAF House. LAF pays the fare back when two or more NCH patients came in the same car."
      />

      <KpiGrid>
        <KpiCard label="To pay back" value={loading ? "…" : due.length} icon={Wallet} color="amber" sublabel={formatCurrency(due.reduce((s, r) => s + (r.fare ?? 0), 0))} />
        <KpiCard label="Paid back this month" value={formatCurrency(paidThisMonth)} icon={CircleCheck} color="green" />
        <KpiCard label="Rides recorded" value={loading ? "…" : rides.length} icon={Car} color="blue" />
      </KpiGrid>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "due" | "all")}>
        <TabsList>
          <TabsTrigger value="due">To pay back ({due.length})</TabsTrigger>
          <TabsTrigger value="all">All rides ({rides.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {shown.length === 0 ? (
        <EmptyState
          title={tab === "due" ? "Nothing to pay back" : "No rides yet"}
          description={tab === "due" ? "Every qualifying ride has been paid back." : "Rides appear when a check-in says the family came by a ride app."}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((r) => {
            const riders = ridersOf(r.id);
            const nReceipts = receipts(r.id);
            return (
              <Card key={r.id}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {formatDate(r.rideDate)} · {ARRIVAL_APP_LABELS[r.app]} · {r.fare !== null ? formatCurrency(r.fare) : "fare not set"}
                      {r.reimbursedAt ? (
                        <Badge variant="secondary">Paid back</Badge>
                      ) : r.reimbursable ? (
                        <Badge>Reimbursable</Badge>
                      ) : (
                        <Badge variant="outline">Not reimbursable</Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {riders.length === 0
                        ? "No riders"
                        : riders.map(({ stay, patient }, i) => (
                            <React.Fragment key={stay.id}>
                              {i > 0 && ", "}
                              <Link href={`/patients/${stay.patientId}`} className="hover:underline">
                                {patient ? `${patient.lastName}, ${patient.firstName}` : "Unknown"}
                              </Link>
                            </React.Fragment>
                          ))}
                      {!r.reimbursable && !r.reimbursedAt ? ` · ${whyNot(r)}` : ""}
                    </span>
                    {r.reimbursedAt && (
                      <span className="text-xs text-muted-foreground">
                        {formatCurrency(r.reimbursedAmount ?? 0)} to {r.reimbursedTo} on {formatDate(r.reimbursedAt)} · recorded by {staffName(r.reimbursedBy)}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setReceiptFor(r)}>
                      <Paperclip className="size-3.5" />
                      {nReceipts ? `Receipt (${nReceipts})` : "Receipt"}
                    </Button>
                    {canEdit && !r.reimbursedAt && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setFareFor(r)}>
                        {r.fare === null ? "Set fare" : "Edit fare"}
                      </Button>
                    )}
                    {canEdit && r.reimbursable && !r.reimbursedAt && (
                      <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setPayFor(r)}>
                        <Receipt className="size-3.5" /> Paid back
                      </Button>
                    )}
                    {canEdit && r.reimbursedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-xs text-muted-foreground"
                        onClick={async () => {
                          const res = await undoReimbursed(r.id);
                          if (res.ok) toast.success("Pay-out removed");
                          else toast.error(res.error);
                        }}
                      >
                        <Undo2 className="size-3.5" /> Undo
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!receiptFor} onOpenChange={(open) => !open && setReceiptFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Receipt</DialogTitle>
            <DialogDescription>
              {receiptFor ? `${ARRIVAL_APP_LABELS[receiptFor.app]} ride on ${formatDate(receiptFor.rideDate)}: a photo or screenshot of the receipt.` : ""}
            </DialogDescription>
          </DialogHeader>
          {receiptFor && <FileLibrary recordType="ride" recordId={receiptFor.id} canUpload={canEdit} canDelete={canEdit} compact />}
        </DialogContent>
      </Dialog>

      {fareFor && <FareDialog key={fareFor.id} ride={fareFor} onClose={() => setFareFor(null)} onSave={(fare) => setFare(fareFor.id, fare)} />}
      {payFor && (
        <PayDialog
          key={payFor.id}
          ride={payFor}
          carerNames={ridersOf(payFor.id).flatMap(({ stay }) => {
            const c = carers.find((x) => x.id === stay.carerId);
            return c ? [c.name] : [];
          })}
          onClose={() => setPayFor(null)}
          onSave={(p) => markReimbursed(payFor.id, p)}
        />
      )}
    </div>
  );
}

function FareDialog({ ride, onClose, onSave }: { ride: ArrivalRide; onClose: () => void; onSave: (fare: number | null) => Promise<{ ok: boolean; error?: string }> }) {
  const [fare, setFare] = React.useState(ride.fare === null ? "" : String(ride.fare));
  const value = fare.trim() === "" ? null : Number(fare);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Fare</DialogTitle>
          <DialogDescription>The total on the {ARRIVAL_APP_LABELS[ride.app]} receipt.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="fare">Fare (₱)</FieldLabel>
          <Input id="fare" type="number" inputMode="decimal" min={0} step="0.01" value={fare} onChange={(e) => setFare(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={value !== null && !(value >= 0)}
            onClick={async () => {
              const r = await onSave(value);
              if (!r.ok) toast.error(`Couldn't save: ${r.error}`);
              else onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ ride, carerNames, onClose, onSave }: {
  ride: ArrivalRide;
  carerNames: string[];
  onClose: () => void;
  onSave: (p: { on: string; amount: number; to: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [amount, setAmount] = React.useState(ride.fare === null ? "" : String(ride.fare));
  const [to, setTo] = React.useState(carerNames[0] ?? "");
  const [on, setOn] = React.useState(todayIso());
  const n = Number(amount);
  const ready = amount.trim() !== "" && n >= 0 && to.trim() !== "" && !!on;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Paid back</DialogTitle>
          <DialogDescription>
            {ARRIVAL_APP_LABELS[ride.app]} ride on {formatDate(ride.rideDate)}. The pay-out is signed with your name.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="payTo">Paid to</FieldLabel>
          <Input id="payTo" list="pay-to-carers" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who received the money" />
          <datalist id="pay-to-carers">
            {carerNames.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="payAmount">Amount (₱)</FieldLabel>
            <Input id="payAmount" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="payOn">Paid on</FieldLabel>
            <Input id="payOn" type="date" max={todayIso()} value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready}
            onClick={async () => {
              const r = await onSave({ on, amount: n, to: to.trim() });
              if (!r.ok) toast.error(`Couldn't save: ${r.error}`);
              else {
                toast.success("Pay-out recorded");
                onClose();
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
