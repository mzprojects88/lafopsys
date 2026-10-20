"use client";

import * as React from "react";
import { toast } from "sonner";
import { Banknote, BedDouble, ChevronLeft, ChevronRight, Download, FileCheck2, Plus, RefreshCw, Users } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRole } from "@/context/role-provider";
import { holdsPower } from "@/lib/rbac/roles";
import { useCafBills, type CafBill, type CafStatus } from "@/lib/hooks/use-caf-billing";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { cafAmounts, cafDay, cafMonthLabel, cafTotals } from "@/lib/utils/caf";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { downloadPdf } from "@/lib/utils/download-pdf";
import { plainError } from "@/lib/utils/plain-error";

const STATUS: Record<CafStatus, { label: string; variant: "outline" | "secondary" | "default" }> = {
  draft: { label: "Draft", variant: "outline" },
  final: { label: "Final", variant: "secondary" },
  sent: { label: "Sent to NCH", variant: "secondary" },
  paid: { label: "Paid", variant: "default" },
};
const firstOf = (ym: string) => `${ym}-01`;
const shiftMonth = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const daysOf = (ym: string) => {
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`);
};

/**
 * Reports > NCH billing (0098): the month's bill to National Children's Hospital's Cancer
 * Assistance Fund, from the nights at LAF. The social worker (or the Office Admin) drafts it,
 * corrects a child's nights with a reason, makes it final and downloads the package; the CEO reads
 * it. Amounts are worked out from the nights (lib/utils/caf.ts), never typed.
 */
export default function CafBillingPage() {
  const { roles } = useRole();
  const canPrepare = holdsPower(roles, "caf_billing");
  const isSuperAdmin = roles.includes("admin");
  const { bills, loading, draft, setStatus, reopen } = useCafBills();
  const { patients } = usePatientsData();
  const [ym, setYm] = React.useState(() => shiftMonth(todayIso().slice(0, 7), -1));
  const [busy, setBusy] = React.useState(false);
  const [nightsFor, setNightsFor] = React.useState<{ patientId: string | null } | null>(null);
  const [paying, setPaying] = React.useState(false);
  const [reopening, setReopening] = React.useState(false);

  const bill = bills.find((b) => b.month === firstOf(ym));
  const terms = bill ? { rate: bill.rate, cap: bill.cap, discountPct: bill.discountPct } : null;
  const nameOf = (id: string) => {
    const p = patients.find((x) => x.id === id);
    return p ? `${p.lastName}, ${p.firstName}` : "Child on file";
  };
  const lines = bill ? [...bill.lines].sort((a, b) => nameOf(a.patientId).localeCompare(nameOf(b.patientId))) : [];
  const totals = bill && terms ? cafTotals(bill.lines, terms) : null;

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) {
    setBusy(true);
    const r = await fn();
    setBusy(false);
    if (!r.ok) toast.error(plainError(r.error));
    else toast.success(ok);
    return r.ok;
  }

  async function download(patientId?: string) {
    if (!bill) return;
    const name = `NCH-CAF-${cafMonthLabel(bill.month).replace(" ", "-")}${patientId ? `-${nameOf(patientId).split(",")[0]}` : ""}.pdf`;
    const r = await downloadPdf("/api/caf/pdf", { billingId: bill.id, ...(patientId ? { patientId } : {}) }, name);
    if (!r.ok) toast.error(plainError(r.error));
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="NCH billing"
        description="The month's bill to NCH's Cancer Assistance Fund, from the nights at LAF: the first 15 nights per child are billable, with the PWD discount. Download the Billing Statement, Statements of Account and Endorsement Letters in one file."
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => setYm((m) => shiftMonth(m, -1))}>
          <ChevronLeft />
        </Button>
        <Input type="month" aria-label="Month" className="w-44" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} />
        <Button size="icon-sm" variant="outline" aria-label="Next month" onClick={() => setYm((m) => shiftMonth(m, 1))}>
          <ChevronRight />
        </Button>
        {bill && <Badge variant={STATUS[bill.status].variant}>{STATUS[bill.status].label}</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          {bill && (
            <Button variant="outline" onClick={() => void download()}>
              <Download /> Download package
            </Button>
          )}
          {canPrepare && bill?.status === "draft" && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => run(() => draft(firstOf(ym)), "Refreshed from the nights at LAF")}>
                <RefreshCw /> Refresh
              </Button>
              <Button variant="outline" onClick={() => setNightsFor({ patientId: null })}>
                <Plus /> Add a child
              </Button>
              <Button disabled={busy || lines.length === 0} onClick={() => run(() => setStatus(bill.id, "final"), "The bill is final")}>
                <FileCheck2 /> Make final
              </Button>
            </>
          )}
          {canPrepare && bill?.status === "final" && (
            <Button disabled={busy} onClick={() => run(() => setStatus(bill.id, "sent"), "Marked sent to NCH")}>
              Mark sent to NCH
            </Button>
          )}
          {canPrepare && bill?.status === "sent" && <Button onClick={() => setPaying(true)}>Mark paid</Button>}
          {isSuperAdmin && bill && bill.status !== "draft" && (
            <Button variant="outline" onClick={() => setReopening(true)}>
              Reopen
            </Button>
          )}
        </div>
      </div>

      {loading && !bill ? (
        <p className="text-theme-sm text-muted-foreground">Loading…</p>
      ) : !bill || !terms || !totals ? (
        <EmptyState
          icon={Banknote}
          title={`No bill for ${cafMonthLabel(firstOf(ym))} yet`}
          description={canPrepare ? "Start the draft: every child billed to the Fund who slept at LAF that month is listed with their nights." : "The social worker prepares it."}
          action={
            canPrepare ? (
              <Button disabled={busy} onClick={() => run(() => draft(firstOf(ym)), "Draft made from the nights at LAF")}>
                Start the draft
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <KpiGrid>
            <KpiCard label="Children" value={String(totals.children)} icon={Users} />
            <KpiCard label="Stays / billable" value={`${totals.stays} / ${totals.billable}`} icon={BedDouble} sublabel={`At most ${terms.cap} a month each`} />
            <KpiCard label="Gross" value={formatCurrency(totals.gross)} icon={Banknote} />
            <KpiCard
              label="Amount due"
              value={formatCurrency(totals.net)}
              icon={Banknote}
              tone="positive"
              sublabel={bill.status === "paid" ? `Paid ${bill.paidOn ? formatDate(bill.paidOn) : ""}${bill.paidRef ? ` · ${bill.paidRef}` : ""}` : bill.invoiceDate ? `Invoice ${formatDate(bill.invoiceDate)}` : "Draft"}
            />
          </KpiGrid>
          {bill.reopenReason && bill.status === "draft" && <p className="text-theme-xs text-muted-foreground">Reopened: {bill.reopenReason}</p>}

          <SectionCard title={`${cafMonthLabel(bill.month)} · ${lines.length} child${lines.length === 1 ? "" : "ren"}`} flush>
            {lines.length === 0 ? (
              <p className="px-5 py-4 text-theme-sm text-muted-foreground">No child billed to the Fund slept at LAF this month. Add one by hand if the nights were before the app was used.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-theme-sm">
                  <thead className="text-left text-theme-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="px-5 py-2 font-medium">Child</th>
                      <th className="px-3 py-2 text-right font-medium">Stays</th>
                      <th className="px-3 py-2 text-right font-medium">Billable</th>
                      <th className="px-3 py-2 text-right font-medium">Gross</th>
                      <th className="px-3 py-2 text-right font-medium">Due</th>
                      <th className="px-5 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {lines.map((l) => {
                      const a = cafAmounts(l, terms);
                      return (
                        <tr key={l.patientId}>
                          <td className="px-5 py-2">
                            <span className="font-medium">{nameOf(l.patientId)}</span>
                            {l.pwd && <Badge variant="outline" className="ml-2">PWD</Badge>}
                            <span className="block text-theme-xs text-muted-foreground">
                              {a.billableNights.length ? `${cafDay(a.billableNights[0]!)} – ${cafDay(a.billableNights[a.billableNights.length - 1]!)}` : ""}
                              {l.manualReason ? ` · set by hand: ${l.manualReason}` : ""}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{a.stays}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{a.billable}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(a.gross)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCurrency(a.net)}</td>
                          <td className="px-5 py-2 text-right whitespace-nowrap">
                            {canPrepare && bill.status === "draft" && (
                              <Button size="sm" variant="ghost" onClick={() => setNightsFor({ patientId: l.patientId })}>
                                Nights
                              </Button>
                            )}
                            <Button size="icon-sm" variant="ghost" aria-label={`Download ${nameOf(l.patientId)}'s Statement and Letter`} onClick={() => void download(l.patientId)}>
                              <Download />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {nightsFor && bill && (
        <NightsDialog bill={bill} patientId={nightsFor.patientId} nameOf={nameOf} onClose={() => setNightsFor(null)} />
      )}
      {paying && bill && <PaidDialog bill={bill} onClose={() => setPaying(false)} />}
      {reopening && bill && (
        <ReasonDialog
          title="Reopen the bill"
          description="It goes back to draft so the nights can be corrected; the reason is kept on the bill."
          onSave={(reason) => run(() => reopen(bill.id, reason), "Reopened as a draft")}
          onClose={() => setReopening(false)}
        />
      )}
    </div>
  );
}

/** A child's nights in the month, ticked by hand with the reason (also adds a child to the bill). */
function NightsDialog({ bill, patientId, nameOf, onClose }: { bill: CafBill; patientId: string | null; nameOf: (id: string) => string; onClose: () => void }) {
  const { setNights } = useCafBills();
  const { patients } = usePatientsData();
  const ym = bill.month.slice(0, 7);
  const line = bill.lines.find((l) => l.patientId === patientId);
  const [child, setChild] = React.useState(patientId ?? "");
  const [nights, setNightsState] = React.useState<Set<string>>(() => new Set(line?.nights ?? []));
  const [reason, setReason] = React.useState(line?.manualReason ?? "");
  const [saving, setSaving] = React.useState(false);
  const candidates = patients
    .filter((p) => p.cafBilling && !bill.lines.some((l) => l.patientId === p.id))
    .sort((a, b) => a.lastName.localeCompare(b.lastName));

  async function save() {
    setSaving(true);
    const r = await setNights(bill.id, child, [...nights].sort(), reason.trim());
    setSaving(false);
    if (!r.ok) {
      toast.error(plainError(r.error));
      return;
    }
    toast.success(nights.size ? "Nights saved" : "Taken off the bill");
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{patientId ? nameOf(patientId) : "Add a child"} · {cafMonthLabel(bill.month)}</DialogTitle>
          <DialogDescription>Tick the nights the child slept at LAF. The first {bill.cap} are billable. Untick every night to take the child off the bill.</DialogDescription>
        </DialogHeader>
        {!patientId && (
          <Field>
            <FieldLabel htmlFor="cafChild">Child</FieldLabel>
            <Select value={child} onValueChange={setChild}>
              <SelectTrigger id="cafChild" className="w-full">
                <SelectValue placeholder="Children billed to the Fund" />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.lastName}, {p.firstName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>Only children marked &quot;Billed to NCH&apos;s Cancer Assistance Fund&quot; on their record.</FieldDescription>
          </Field>
        )}
        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Nights">
          {daysOf(ym).map((d) => {
            const on = nights.has(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={cafDay(d)}
                onClick={() =>
                  setNightsState((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(d);
                    else next.add(d);
                    return next;
                  })
                }
                className={`h-9 rounded-lg border text-theme-xs font-medium ${on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted"}`}
              >
                {Number(d.slice(8, 10))}
              </button>
            );
          })}
        </div>
        <Field>
          <FieldLabel htmlFor="cafReason">Why the nights are set by hand</FieldLabel>
          <Input id="cafReason" value={reason} maxLength={200} placeholder="e.g. 1-12 Oct from the House Sheet, before the app was used" onChange={(e) => setReason(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!child || reason.trim().length < 3 || saving} onClick={save}>
            {saving ? "Saving…" : `Save ${nights.size} night${nights.size === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaidDialog({ bill, onClose }: { bill: CafBill; onClose: () => void }) {
  const { setStatus } = useCafBills();
  const [date, setDate] = React.useState(todayIso());
  const [ref, setRef] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  async function save() {
    setSaving(true);
    const r = await setStatus(bill.id, "paid", date, ref);
    setSaving(false);
    if (!r.ok) return toast.error(plainError(r.error));
    toast.success("Marked paid");
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Paid · {cafMonthLabel(bill.month)}</DialogTitle>
          <DialogDescription>When NCH&apos;s payment reached the account, and its reference.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="cafPaidOn">Paid on</FieldLabel>
          <Input id="cafPaidOn" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="cafPaidRef">Reference (optional)</FieldLabel>
          <Input id="cafPaidRef" value={ref} maxLength={80} placeholder="Deposit slip or check number" onChange={(e) => setRef(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!date || saving} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({ title, description, onSave, onClose }: { title: string; description: string; onSave: (reason: string) => Promise<boolean>; onClose: () => void }) {
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input aria-label="Reason" value={reason} maxLength={200} placeholder="Reason" onChange={(e) => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={reason.trim().length < 3 || saving}
            onClick={async () => {
              setSaving(true);
              const ok = await onSave(reason.trim());
              setSaving(false);
              if (ok) onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
