"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, UsersRound } from "lucide-react";
import { SectionCard } from "@/components/patterns/section-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setAuthority, type SetupRow } from "@/lib/hooks/use-finance-setup";
import { whoSigns, type AuthorityRow } from "@/lib/utils/authority";
import { formatCurrency } from "@/lib/utils/currency";

type Option = { value: string; label: string };
const NONE = "__none";
type Pair = { staff: string; alt: string };

/** A signer and their alternate, picked from the staff. */
function PairPick({ label, value, onChange, people, hint }: { label: string; value: Pair; onChange: (p: Pair) => void; people: Option[]; hint?: string }) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select value={value.staff || NONE} onValueChange={(v) => onChange({ ...value, staff: v === NONE ? "" : v })}>
          <SelectTrigger className="w-full" aria-label={`${label}: signer`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Pick the signer</SelectItem>
            {people.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={value.alt || NONE} onValueChange={(v) => onChange({ ...value, alt: v === NONE ? "" : v })}>
          <SelectTrigger className="w-full" aria-label={`${label}: alternate`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No alternate</SelectItem>
            {people.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {hint ? <FieldDescription>{hint}</FieldDescription> : null}
    </Field>
  );
}

/** The current matrix read back into the form (best effort: the first row of each kind). */
function fromRows(rows: SetupRow[], roles: Option[]) {
  const pair = (r?: SetupRow): Pair => ({ staff: String(r?.staff_id ?? ""), alt: String(r?.alternate_staff_id ?? "") });
  const of = (step: string) => rows.filter((r) => r.step === step && !r.urgent);
  const approvers = of("approve").sort((a, b) => Number(a.min_amount ?? 0) - Number(b.min_amount ?? 0));
  return {
    endorse: Object.fromEntries(roles.map((r) => {
      const row = rows.find((x) => x.step === "endorse" && x.requester_role === r.value);
      return [r.value, row ? (row.staff_id ? String(row.staff_id) : NONE) : ""];
    })) as Record<string, string>,
    validate: pair(of("validate")[0]),
    review: pair(of("review")[0]),
    below: pair(approvers[0]),
    threshold: approvers.length > 1 ? String(approvers[1].min_amount ?? "") : "",
    above: pair(approvers[1]),
    urgent: pair(rows.find((r) => r.step === "approve" && r.urgent)),
    payment: pair(of("approve_payment")[0]),
    release: pair(of("release")[0]),
  };
}

/** The rows a form saves (the inverse of fromRows). */
function toRows(form: ReturnType<typeof fromRows>, roles: Option[]) {
  const threshold = Number(form.threshold) || 0;
  const row = (step: string, p: Pair, extra: Record<string, unknown> = {}) => ({ step, requester_role: null, staff_id: p.staff || null, alternate_staff_id: p.alt || null, min_amount: 0, max_amount: null, urgent: false, ...extra });
  return [
    ...roles.map((r) => ({ step: "endorse", requester_role: r.value, staff_id: form.endorse[r.value] === NONE ? null : form.endorse[r.value], alternate_staff_id: null, min_amount: 0, max_amount: null, urgent: false })),
    row("validate", form.validate),
    row("review", form.review),
    ...(threshold > 0 ? [row("approve", form.below, { max_amount: threshold }), row("approve", form.above, { min_amount: threshold })] : [row("approve", form.below)]),
    ...(form.urgent.staff ? [row("approve", form.urgent, { urgent: true })] : []),
    row("approve_payment", form.payment),
    row("release", form.release),
  ];
}
const rowKey = (r: SetupRow) =>
  [r.step, r.requester_role ?? "", Number(r.min_amount ?? 0), r.max_amount == null || r.max_amount === "" ? "" : Number(r.max_amount), r.staff_id ?? "", r.alternate_staff_id ?? "", !!r.urgent].join("|");
/** Whether the form shows a matrix completely: read into the form and saved back, it is the same set of rows. Only
 * then may the form replace it; a more detailed matrix (alternates for endorsers, more bands or signers, a role
 * no longer listed) is edited row by row instead, so nothing is dropped. */
function formFits(rows: SetupRow[], roles: Option[]) {
  if (!rows.length) return true;
  const a = rows.map(rowKey).sort().join("\n");
  const b = toRows(fromRows(rows, roles), roles).map(rowKey).sort().join("\n");
  return a === b;
}

/**
 * Financial Settings › Authority, polish 4: every signer set in one form (saved in one transaction, 0144), and a
 * checker that shows who signs a role's request at an amount, warning about any step nobody covers.
 */
export function AuthoritySetup({ rows, people, roles }: { rows: SetupRow[]; people: Option[]; roles: Option[] }) {
  const name = (id: string) => people.find((p) => p.value === id)?.label ?? "—";
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState(() => fromRows(rows, roles));
  const [busy, setBusy] = React.useState(false);
  const [pickedRole, setRole] = React.useState("");
  // The roles arrive after the first render: until one is picked, the first.
  const role = pickedRole || roles[0]?.value || "";
  const fits = formFits(rows, roles);
  const [amount, setAmount] = React.useState("1000");
  const [urgent, setUrgent] = React.useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const threshold = Number(form.threshold) || 0;
  const missing = [
    ...roles.filter((r) => !form.endorse[r.value]).map((r) => `who endorses for ${r.label}`),
    ...(form.validate.staff ? [] : ["Finance's preparer"]),
    ...(form.review.staff ? [] : ["the reviewer"]),
    ...(form.below.staff ? [] : ["the approver"]),
    ...(threshold > 0 && !form.above.staff ? [`the approver from ${formatCurrency(threshold, "PHP", true)}`] : []),
    ...(form.payment.staff ? [] : ["the payment signatory"]),
    ...(form.release.staff ? [] : ["the releaser"]),
    ...(form.urgent.alt && !form.urgent.staff ? ["the urgent approver (an alternate alone signs nothing)"] : []),
    ...([["the preparer", form.validate], ["the reviewer", form.review], ["the approver", form.below], ["the second approver", form.above], ["the urgent approver", form.urgent], ["the payment signatory", form.payment], ["the releaser", form.release]] as const)
      .filter(([, p]) => p.staff && p.staff === p.alt)
      .map(([label]) => `an alternate for ${label} other than the signer`),
  ];

  async function save() {
    const next = toRows(form, roles);
    if (rows.length && !confirm(`This replaces the ${rows.length} signer rows with these ${next.length}. Every change is logged.`)) return;
    setBusy(true);
    const r = await setAuthority(next);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Signers saved");
    setOpen(false);
  }

  const check = whoSigns(rows as unknown as AuthorityRow[], role, Number(amount) || 0, urgent);
  return (
    <>
      <SectionCard
        title="Who signs what"
        description="Pick a requester's role and an amount to see who signs each step, by the same rules the vouchers follow."
        actions={
          fits ? (
            <Button size="sm" onClick={() => (setForm(fromRows(rows, roles)), setOpen(true))}><UsersRound /> Set up the signers</Button>
          ) : (
            <span className="max-w-xs text-right text-theme-xs text-muted-foreground">The signers are set in more detail than the one-page form shows: edit them row by row below.</span>
          )
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-56">
            <FieldLabel>Requester&apos;s role</FieldLabel>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{roles.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field className="w-40">
            <FieldLabel htmlFor="who-amount">Amount (₱)</FieldLabel>
            <Input id="who-amount" type="number" inputMode="decimal" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 pb-2 text-theme-sm"><Switch checked={urgent} onCheckedChange={setUrgent} /> Urgent</label>
        </div>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {check.map((s) => (
            <li key={s.step} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-theme-sm">
              <span className="font-medium">{s.label}</span>
              {s.notNeeded ? (
                <span className="text-muted-foreground">Not needed for this role</span>
              ) : s.signers.length ? (
                <span>{s.signers.map(name).join(" or ")}</span>
              ) : (
                <span className="flex items-center gap-1 text-warning-foreground"><AlertTriangle className="size-4" /> Nobody: the request would wait here</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-theme-xs text-muted-foreground">The requester never signs their own request, and nobody signs two steps that must stay apart: give each step someone else, or an alternate.</p>
      </SectionCard>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Set up the signers</DialogTitle>
            <DialogDescription>Everyone who signs a payment request, in one go. It replaces the rows below in one step; each change is logged.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel>Who endorses each role&apos;s requests</FieldLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((r) => (
                  <Select key={r.value} value={form.endorse[r.value] || ""} onValueChange={(v) => set("endorse", { ...form.endorse, [r.value]: v })}>
                    <SelectTrigger className="w-full" aria-label={`Endorser for ${r.label}`}><SelectValue placeholder={`${r.label}: pick`} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{r.label}: no endorsement needed</SelectItem>
                      {people.map((p) => <SelectItem key={p.value} value={p.value}>{r.label}: {p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ))}
              </div>
            </Field>
            <PairPick label="Prepares the voucher (Finance)" value={form.validate} onChange={(v) => set("validate", v)} people={people} />
            <PairPick label="Reviews it" value={form.review} onChange={(v) => set("review", v)} people={people} />
            <Field>
              <FieldLabel htmlFor="approve-threshold">Approvers by amount</FieldLabel>
              <Input id="approve-threshold" type="number" inputMode="decimal" min={0} placeholder="One approver for any amount" value={form.threshold} onChange={(e) => set("threshold", e.target.value)} />
              <FieldDescription>Give an amount to split: one approver below it, another from it up.</FieldDescription>
            </Field>
            <PairPick label={threshold > 0 ? `Approves under ${formatCurrency(threshold, "PHP", true)}` : "Approves (any amount)"} value={form.below} onChange={(v) => set("below", v)} people={people} />
            {threshold > 0 ? <PairPick label={`Approves from ${formatCurrency(threshold, "PHP", true)}`} value={form.above} onChange={(v) => set("above", v)} people={people} /> : null}
            <PairPick label="Urgent approver (optional)" value={form.urgent} onChange={(v) => set("urgent", v)} people={people} hint="Signs urgent requests between the weekly approvals." />
            <PairPick label="Approves the payment (signatory)" value={form.payment} onChange={(v) => set("payment", v)} people={people} />
            <PairPick label="Releases the payment" value={form.release} onChange={(v) => set("release", v)} people={people} hint="Not the one who prepared or approved the payment." />
          </div>
          <DialogFooter className="flex-wrap items-center">
            {missing.length ? <p className="mr-auto text-theme-xs text-warning-foreground">Still needed: {missing.join("; ")}.</p> : null}
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={busy || missing.length > 0} onClick={() => void save()}>{busy ? "Saving…" : "Save the signers"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
