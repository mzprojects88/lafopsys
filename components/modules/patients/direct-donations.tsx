"use client";

import * as React from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Download, Gift, HandHeart, Loader2, Pencil, Plus, ScanLine, Search, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { itemsLabel, newDirectKey, progress, qty, shareNow, type DirectDonation, type DirectGive, type DirectPatientView } from "@/lib/direct/direct";

/**
 * Donations given directly to patients (LAF-DTP, Inventory 0082/0083). The same component runs in LAF Inventory and
 * in ArkOS: everything is read and written through inventory.* calls, so each person sees what their role allows.
 * Receive (its own AR series) -> give one share per child by scanning the Patient ID card (or by name) -> progress.
 * Every write carries a client key: the same key sent again returns the first result instead of saving twice.
 */
export interface DirectDonationsProps {
  /** The person's name, written on what they receive. */
  staffName: string;
  /** Super Admin, Office Admin, Social Worker: may give without a card. */
  canByName: boolean;
  /** Inventory Lead, Super Admin: may undo a give. */
  canUndo: boolean;
  /** May receive and give (the six roles). Others only read. */
  canGive: boolean;
  /** The app's camera scanner for a Patient ID card: calls onToken with the card's code. */
  Scanner: React.ComponentType<{ onToken: (token: string) => void; onClose: () => void }>;
  /** Download the AR of a receipt (each app has its own PDF door). */
  onDownloadAr?: (donation: { id: string; arNumber: string }) => void;
  /** Something was received, given or undone: the app's bell and dashboard card read again. */
  onChanged?: () => void;
}

const inv = () => createClient().schema("inventory");
const day = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "";
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const todayManila = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function DirectDonations(props: DirectDonationsProps) {
  const [list, setList] = React.useState<DirectDonation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [one, setOne] = React.useState<DirectDonation | null>(null);
  const [receiving, setReceiving] = React.useState(false);
  const [giving, setGiving] = React.useState<{ donationId?: string } | null>(null);

  // Each change (a give, an undo, a new receipt) bumps the tick: the list and the open donation are read again.
  const [tick, setTick] = React.useState(0);
  const { onChanged } = props;
  const refresh = React.useCallback(() => {
    setTick((t) => t + 1);
    onChanged?.();
  }, [onChanged]);

  React.useEffect(() => {
    let off = false;
    void inv()
      .rpc("direct_donations", { p_id: null })
      .then(({ data, error: e }) => {
        if (off) return;
        setError(e ? e.message : null);
        if (!e) setList((data ?? []) as DirectDonation[]);
      });
    return () => {
      off = true;
    };
  }, [tick]);
  React.useEffect(() => {
    if (!openId) return;
    let off = false;
    void inv()
      .rpc("direct_donations", { p_id: openId })
      .then(({ data, error: e }) => {
        if (off) return;
        if (e) return void toast.error(e.message);
        setOne(((data ?? []) as DirectDonation[])[0] ?? null);
      });
    return () => {
      off = true;
    };
  }, [openId, tick]);

  const dialogs = (
    <>
      {receiving ? (
        <ReceiveDialog
          staffName={props.staffName}
          onClose={() => setReceiving(false)}
          onSaved={(id) => {
            setReceiving(false);
            refresh();
            setOpenId(id);
          }}
        />
      ) : null}
      {giving ? <GiveDialog {...props} donationId={giving.donationId} onClose={() => setGiving(null)} onGiven={refresh} /> : null}
    </>
  );

  if (openId) {
    return (
      <>
        <OneDonation {...props} donation={one?.id === openId ? one : null} onBack={() => setOpenId(null)} onGive={() => setGiving({ donationId: openId })} onChanged={refresh} />
        {dialogs}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          Goods a donor gave for the patients themselves. Scan a child&apos;s ID card to give them their share; these goods can&apos;t be drawn for anything else.
        </p>
        {props.canGive ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setGiving({})}>
              <ScanLine className="size-4" /> Scan ID card to give
            </Button>
            <Button type="button" variant="outline" onClick={() => setReceiving(true)}>
              <Plus className="size-4" /> Receive a donation
            </Button>
          </div>
        ) : null}
      </div>
      {error ? <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : null}
      {!list && !error ? <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p> : null}
      {list && list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <Gift className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-medium">No donations for patients yet</p>
          <p className="mt-1 text-sm text-muted-foreground">When a donor gives goods for the patients, receive them here. Each gets an AR numbered LAF-DTP.</p>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(list ?? []).map((d) => {
          const p = progress(d);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => setOpenId(d.id)}
              className="rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{d.arNumber}</p>
                  <p className="truncate text-sm text-muted-foreground">{d.donor ?? "Anonymous donor"} · {day(d.date)}</p>
                </div>
                <StateBadge d={d} />
              </div>
              <p className="mt-3 line-clamp-2 text-sm">{d.items.map((i) => `${i.name} (${qty(i.share)} each)`).join(", ")}</p>
              <Progress value={p.given} className="mt-3" aria-label={`${p.given}% given`} />
              <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-sm">
                <span>
                  <strong>{p.given}%</strong> given · {p.left}% left
                </span>
                <span className="text-muted-foreground">
                  {d.served}
                  {d.target ? ` of ${d.target}` : ""} {d.served === 1 && !d.target ? "child" : "children"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {dialogs}
    </div>
  );
}

function StateBadge({ d }: { d: DirectDonation }) {
  if (Number(d.left) <= 0) return <Badge variant="secondary">All given</Badge>;
  if (d.overdue) return <Badge variant="destructive">Overdue</Badge>;
  return <Badge variant="outline">{plural(Math.max(0, d.targetDays - d.daysWaiting), "day")} left</Badge>;
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {note ? <p className="mt-0.5 text-sm text-muted-foreground">{note}</p> : null}
    </div>
  );
}

function OneDonation({
  donation: d,
  onBack,
  onGive,
  onChanged,
  canGive,
  canUndo,
  onDownloadAr,
}: DirectDonationsProps & { donation: DirectDonation | null; onBack: () => void; onGive: () => void; onChanged: () => void }) {
  const [undo, setUndo] = React.useState<DirectGive | null>(null);
  const [rule, setRule] = React.useState(false);
  if (!d) {
    return (
      <div className="space-y-4">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> All donations
        </Button>
        <p className="py-10 text-center text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  const p = progress(d);
  const gives = d.gives ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" /> All donations
        </Button>
        <div className="flex flex-wrap gap-2">
          {onDownloadAr ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onDownloadAr({ id: d.id, arNumber: d.arNumber })}>
              <Download className="size-4" /> AR (PDF)
            </Button>
          ) : null}
          {canGive && Number(d.left) > 0 ? (
            <Button type="button" size="sm" onClick={onGive}>
              <ScanLine className="size-4" /> Scan ID card to give
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{d.arNumber}</h2>
            <p className="text-sm text-muted-foreground">
              {d.donor ?? "Anonymous donor"} · received {day(d.date)}
              {d.receivedBy ? ` by ${d.receivedBy}` : ""}
            </p>
          </div>
          <StateBadge d={d} />
        </div>
        {d.note ? <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-sm">Donor&apos;s wish: {d.note}</p> : null}
        <Progress value={p.given} className="mt-4" aria-label={`${p.given}% given`} />
        <p className="mt-2 text-sm">
          <strong>{p.given}% given</strong> ({qty(d.given)} of {qty(p.total)}) · <strong>{p.left}% remaining</strong> ({qty(d.left)})
          {Number(d.wasted) > 0 ? ` · ${p.wasted}% written off (${qty(d.wasted)})` : ""}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Children served" value={d.target ? `${d.served} of ${d.target}` : d.served} note={d.target ? `${Math.max(0, d.target - d.served)} still to receive` : undefined} />
        <Stat label="Shares given" value={d.firstShares + d.extraShares} note={d.extraShares ? `${d.extraShares} extra` : "No extra shares"} />
        <Stat label="Waiting" value={plural(d.daysWaiting, "day")} note={Number(d.left) > 0 ? `Give all by ${day(d.dueOn)}` : `Last given ${when(d.lastGivenAt)}`} />
        <Stat label="Last given" value={d.lastGivenAt ? when(d.lastGivenAt) : "Not yet"} />
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h3 className="font-semibold">The goods</h3>
          {canGive ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setRule(true)}>
              <Pencil className="size-4" /> Change the share
            </Button>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium">Each patient gets</th>
                <th className="px-3 py-2 font-medium">Given</th>
                <th className="px-5 py-2 font-medium">Left</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.itemId} className="border-t border-border">
                  <td className="px-5 py-2.5">{i.name}</td>
                  <td className="px-3 py-2.5">
                    {qty(i.share)} {i.uom}
                  </td>
                  <td className="px-3 py-2.5">{qty(i.given)}</td>
                  <td className="px-5 py-2.5 font-medium">{qty(i.left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card">
        <h3 className="border-b border-border px-5 py-3 font-semibold">Who received ({gives.filter((g) => !g.undoneAt).length})</h3>
        {gives.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nobody yet. Scan a child&apos;s ID card to give the first share.</p>
        ) : (
          <ul className="divide-y divide-border">
            {gives.map((g) => (
              <li key={g.id} className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-5 py-3 ${g.undoneAt ? "opacity-60" : ""}`}>
                <div className="min-w-0">
                  <p className={`font-medium ${g.undoneAt ? "line-through" : ""}`}>
                    {g.name ?? `Patient ${g.caseNumber ?? ""}`}
                    {g.name && g.caseNumber ? <span className="font-normal text-muted-foreground"> · {g.caseNumber}</span> : null}
                  </p>
                  <p className="text-sm">{itemsLabel(g.items)}</p>
                  <p className="text-sm text-muted-foreground">
                    {when(g.givenAt)} · given by {g.givenBy ?? "staff"} · {g.card ? "card scanned" : "by name, no card"} · {g.trace}
                  </p>
                  {g.undoneAt ? (
                    <p className="text-sm text-destructive">
                      Undone {when(g.undoneAt)} by {g.undoneBy ?? "staff"}: {g.undoReason}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  {g.shareNo > 1 && !g.undoneAt ? <Badge variant="outline">Extra share {g.shareNo}</Badge> : null}
                  {canUndo && !g.undoneAt ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setUndo(g)}>
                      <Undo2 className="size-4" /> Undo
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {undo ? <UndoDialog give={undo} onClose={() => setUndo(null)} onDone={onChanged} /> : null}
      {rule ? <RuleDialog donation={d} onClose={() => setRule(false)} onDone={onChanged} /> : null}
    </div>
  );
}

function UndoDialog({ give, onClose, onDone }: { give: DirectGive; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const key = React.useRef(newDirectKey("dtu"));
  async function save() {
    setBusy(true);
    const { error } = await inv().rpc("undo_direct_give", { p_give_id: give.id, p_reason: reason, p_client_key: key.current });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success("Give undone. The goods are back in stock for patients.");
    onDone();
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Undo this give?</DialogTitle>
          <DialogDescription>
            {give.trace}: {itemsLabel(give.items)}. The goods go back to the donation; the give stays on the list, marked undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="undo-reason">Why is it undone?</Label>
          <Textarea id="undo-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded on the wrong child" />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button type="button" variant="destructive" disabled={busy || reason.trim().length < 5} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />} Undo the give
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleDialog({ donation, onClose, onDone }: { donation: DirectDonation; onClose: () => void; onDone: () => void }) {
  const [shares, setShares] = React.useState<Record<string, string>>(() => Object.fromEntries(donation.items.map((i) => [i.itemId, qty(i.share)])));
  const [note, setNote] = React.useState(donation.note ?? "");
  const [busy, setBusy] = React.useState(false);
  const ok = donation.items.every((i) => Number(shares[i.itemId]) > 0);
  async function save() {
    setBusy(true);
    const { error } = await inv().rpc("update_direct_rule", {
      p_donation_id: donation.id,
      p_shares: Object.fromEntries(donation.items.map((i) => [i.itemId, Number(shares[i.itemId])])),
      p_note: note,
    });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success("Share updated.");
    onDone();
    onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>How many does each patient get?</DialogTitle>
          <DialogDescription>{donation.arNumber}. Shares already given stay as they were.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {donation.items.map((i) => (
            <div key={i.itemId} className="flex items-center justify-between gap-3">
              <Label htmlFor={`share-${i.itemId}`} className="min-w-0 flex-1 truncate">
                {i.name} ({i.uom})
              </Label>
              <Input id={`share-${i.itemId}`} className="w-24" inputMode="decimal" value={shares[i.itemId] ?? ""} onChange={(e) => setShares((s) => ({ ...s, [i.itemId]: e.target.value }))} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="rule-note">Donor&apos;s wish (optional)</Label>
            <Textarea id="rule-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !ok} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Scan (or find by name) -> the child and the donations with goods left -> confirm -> given. */
export function GiveDialog({
  donationId,
  initialToken,
  onClose,
  onGiven,
  canByName,
  Scanner,
}: Pick<DirectDonationsProps, "canByName"> & {
  Scanner?: DirectDonationsProps["Scanner"];
  donationId?: string;
  /** A card already scanned (the scan page): the dialog opens on that child, with no "Next child". */
  initialToken?: string;
  onClose: () => void;
  onGiven: () => void;
}) {
  const [who, setWho] = React.useState<{ token?: string; patient_id?: string } | null>(null);
  const [view, setView] = React.useState<DirectPatientView | null>(null);
  const [scanning, setScanning] = React.useState(!initialToken);
  const [finding, setFinding] = React.useState(false);
  const [found, setFound] = React.useState<{ patientId: string; name: string; caseNumber: string | null }[]>([]);
  const [q, setQ] = React.useState("");
  const [confirm, setConfirm] = React.useState<{ donation: NonNullable<DirectPatientView["donations"]>[number]; key: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<DirectGive[]>([]);

  const show = React.useCallback((w: { token?: string; patient_id?: string }, data: unknown, error: { message: string } | null) => {
    if (error) return void toast.error(error.message);
    const v = data as DirectPatientView;
    if (v.status !== "active") {
      toast.error(v.status === "unknown" ? "That code is not a working Patient ID card." : `That card (version ${v.version}) no longer works. Ask for the child's current card.`);
      return;
    }
    setWho(w);
    setView(v);
  }, []);
  const look = React.useCallback(
    async (w: { token?: string; patient_id?: string }) => {
      const { data, error } = await inv().rpc("direct_for_patient", { p: w });
      show(w, data, error);
    },
    [show]
  );
  React.useEffect(() => {
    if (!initialToken) return;
    let off = false;
    void inv()
      .rpc("direct_for_patient", { p: { token: initialToken } })
      .then(({ data, error }) => {
        if (!off) show({ token: initialToken }, data, error);
      });
    return () => {
      off = true;
    };
  }, [initialToken, show]);

  React.useEffect(() => {
    if (!finding || q.trim().length < 2) return;
    const t = setTimeout(() => {
      void inv()
        .rpc("direct_find_patient", { p_q: q })
        .then(({ data, error }) => {
          if (!error) setFound((data ?? []) as { patientId: string; name: string; caseNumber: string | null }[]);
        });
    }, 250);
    return () => clearTimeout(t);
  }, [q, finding]);

  async function give() {
    if (!confirm || !who) return;
    setBusy(true);
    const { data, error } = await inv().rpc("give_direct_donation", {
      p: { client_key: confirm.key, donation_id: confirm.donation.id, expected_share_no: confirm.donation.nextShareNo, ...who },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      // The share number moved (another phone gave it) or the goods ran out: show the child's page as it is now.
      if (error.code === "DG409" || error.code === "23514") {
        setConfirm(null);
        void look(who);
      }
      return; // any other failure keeps the key: Give again sends the same key, so nothing is saved twice
    }
    const g = data as DirectGive;
    setDone((d) => [g, ...d]);
    toast.success(g.replayed ? `Already recorded: ${g.trace}` : `Given: ${itemsLabel(g.items)} (${g.trace})`);
    setConfirm(null);
    onGiven();
    void look(who);
  }

  const donations = (view?.donations ?? []).filter((d) => !donationId || d.id === donationId);

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{view ? view.name : "Give to a patient"}</DialogTitle>
            <DialogDescription>
              {view
                ? `${view.caseNumber ?? ""}${view.carer ? ` · with ${view.carer}` : ""}${view.card ? "" : " · by name, no card"}`
                : "Scan the child's Patient ID card. It is the surest way to give to the right child."}
            </DialogDescription>
          </DialogHeader>

          {!view && initialToken ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Reading the card…</p>
          ) : !view ? (
            <div className="space-y-3">
              <Button type="button" className="h-14 w-full text-base" onClick={() => setScanning(true)}>
                <ScanLine className="size-5" /> Scan ID card
              </Button>
              {canByName ? (
                finding ? (
                  <div className="space-y-2">
                    <Label htmlFor="find-patient">Child&apos;s name or patient number</Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input id="find-patient" className="pl-9" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 2 letters" />
                    </div>
                    <ul className="divide-y divide-border rounded-xl border border-border empty:hidden">
                      {(q.trim().length < 2 ? [] : found).map((f) => (
                        <li key={f.patientId}>
                          <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted" onClick={() => void look({ patient_id: f.patientId })}>
                            <span className="font-medium">{f.name}</span>
                            <span className="text-muted-foreground">{f.caseNumber}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <button type="button" className="mx-auto block text-sm text-muted-foreground underline underline-offset-4" onClick={() => setFinding(true)}>
                    No card with them? Find the child by name
                  </button>
                )
              ) : (
                <p className="text-center text-sm text-muted-foreground">No card with them? The social worker or an admin can give by name.</p>
              )}
            </div>
          ) : confirm ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border p-4">
                <p className="text-sm text-muted-foreground">{confirm.donation.arNumber} · from {confirm.donation.donor ?? "an anonymous donor"}</p>
                <p className="mt-1 text-lg font-semibold">{itemsLabel(shareNow(confirm.donation.items))}</p>
                <p className="text-sm">to {view.name}</p>
              </div>
              {confirm.donation.nextShareNo > 1 ? (
                <p className="flex gap-2 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    This is an <strong>extra share</strong> (share {confirm.donation.nextShareNo}): {view.name} last received on {when(confirm.donation.received.at(-1)?.givenAt)}.
                    {confirm.donation.target && confirm.donation.target > confirm.donation.served
                      ? ` ${plural(confirm.donation.target - confirm.donation.served, "child", "children")} of ${confirm.donation.target} have not received yet.`
                      : ""}
                  </span>
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => setConfirm(null)}>
                  Back
                </Button>
                <Button type="button" className="flex-1" disabled={busy} onClick={give}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <HandHeart className="size-4" />}
                  {confirm.donation.nextShareNo > 1 ? "Give the extra share" : "Give"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {donations.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Nothing is left to give{donationId ? " from this donation" : ""}.</p> : null}
              {donations.map((d) => (
                <div key={d.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{itemsLabel(shareNow(d.items))}</p>
                      <p className="text-sm text-muted-foreground">
                        {d.arNumber} · {d.donor ?? "Anonymous donor"} · {qty(d.left)} left
                      </p>
                    </div>
                    {d.overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                  </div>
                  {d.note ? <p className="mt-2 text-sm">Donor&apos;s wish: {d.note}</p> : null}
                  {d.received.length ? (
                    <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                      Already received {plural(d.received.length, "share")}, last on {when(d.received.at(-1)?.givenAt)}.
                    </p>
                  ) : null}
                  <Button type="button" className="mt-3 w-full" variant={d.received.length ? "outline" : "default"} onClick={() => setConfirm({ donation: d, key: newDirectKey("dtg") })}>
                    <HandHeart className="size-4" /> {d.received.length ? "Give an extra share" : "Give this share"}
                  </Button>
                </div>
              ))}
              {done.length ? <p className="text-sm text-muted-foreground">Given just now: {done.map((g) => g.trace).join(", ")}</p> : null}
              <div className="flex gap-2">
                {initialToken ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setView(null);
                      setWho(null);
                      setDone([]);
                      setScanning(true);
                    }}
                  >
                    <ScanLine className="size-4" /> Next child
                  </Button>
                )}
                <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {scanning && !view && Scanner ? (
        <Scanner
          onClose={() => setScanning(false)}
          onToken={(token) => {
            setScanning(false);
            void look({ token });
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Under a scanned Patient ID card (the ArkOS scan page): the donations for patients that still have goods, with a
 * button to give this child their share. Shows nothing to someone who may not give, or when nothing is left.
 */
export function CardDonations({ token, canByName }: { token: string; canByName: boolean }) {
  const [view, setView] = React.useState<DirectPatientView | null>(null);
  const [open, setOpen] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let off = false;
    void inv()
      .rpc("direct_for_patient", { p: { token } })
      .then(({ data, error }) => {
        if (!off && !error) setView(data as DirectPatientView);
      });
    return () => {
      off = true;
    };
  }, [token, tick]);
  const donations = view?.status === "active" ? (view.donations ?? []) : [];
  if (donations.length === 0) return null;
  const waiting = donations.filter((d) => d.received.length === 0);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold">
            <Gift className="size-4 text-primary" /> Donations for patients
          </p>
          <p className="text-sm text-muted-foreground">
            {waiting.length
              ? `${plural(waiting.length, "donation")} this child has not received: ${waiting.map((d) => itemsLabel(shareNow(d.items))).join("; ")}`
              : `Already received from ${plural(donations.length, "donation")} with goods left. An extra share is possible.`}
          </p>
        </div>
        <Button type="button" variant={waiting.length ? "default" : "outline"} onClick={() => setOpen(true)}>
          <HandHeart className="size-4" /> {waiting.length ? "Give" : "Give an extra share"}
        </Button>
      </div>
      {open ? <GiveDialog initialToken={token} canByName={canByName} onClose={() => setOpen(false)} onGiven={() => setTick((t) => t + 1)} /> : null}
    </div>
  );
}

interface CatalogueItem {
  id: string;
  name: string;
  uom: string;
  category: string;
}
interface Line {
  item: CatalogueItem;
  quantity: string;
  share: string;
  unitValue: string;
}
interface Donor {
  id: string;
  name: string;
}

/** Receive a donation for patients: donor, the goods, and how many each patient gets. One call saves it all. */
function ReceiveDialog({ staffName, onClose, onSaved }: { staffName: string; onClose: () => void; onSaved: (donationId: string) => void }) {
  const [donor, setDonor] = React.useState<Donor | null>(null);
  const [donorQ, setDonorQ] = React.useState("");
  const [donors, setDonors] = React.useState<Donor[]>([]);
  const [donorType, setDonorType] = React.useState("individual");
  const [donatedOn, setDonatedOn] = React.useState(todayManila);
  const [lines, setLines] = React.useState<Line[]>([]);
  const [itemQ, setItemQ] = React.useState("");
  const [cat, setCat] = React.useState<{ items: CatalogueItem[]; categories: string[]; uoms: string[] }>({ items: [], categories: [], uoms: [] });
  const [newItem, setNewItem] = React.useState<{ uom: string; category: string } | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // One key per content of the form: the same form sent again (after a lost reply) is not saved twice.
  const keys = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    if (donor || donorQ.trim().length < 2) return;
    const t = setTimeout(() => {
      void createClient()
        .schema("ops")
        .rpc("donor_directory", { p_search: donorQ.trim(), p_limit: 8 })
        .then(({ data }) => setDonors(((data ?? []) as Donor[]).map((d) => ({ id: d.id, name: d.name }))));
    }, 250);
    return () => clearTimeout(t);
  }, [donorQ, donor]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      void inv()
        .rpc("direct_catalogue", { p_q: itemQ })
        .then(({ data, error }) => {
          if (!error && data) setCat(data as { items: CatalogueItem[]; categories: string[]; uoms: string[] });
        });
    }, 250);
    return () => clearTimeout(t);
  }, [itemQ]);

  async function addDonor() {
    const { data, error } = await createClient().schema("ops").rpc("add_donor_basic", { p_name: donorQ.trim(), p_type: donorType, p_jurisdiction: "PH" });
    if (error) return void toast.error(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as Donor | undefined;
    if (row) setDonor({ id: row.id, name: row.name });
  }
  function addLine(item: CatalogueItem) {
    if (lines.some((l) => l.item.id === item.id)) return void toast.error(`${item.name} is already on the list. Change its quantity instead.`);
    setLines((l) => [...l, { item, quantity: "", share: "1", unitValue: "" }]);
    setItemQ("");
    setNewItem(null);
  }
  async function addNewItem() {
    if (!newItem) return;
    const { data, error } = await inv().rpc("direct_add_item", { p_name: itemQ.trim(), p_uom: newItem.uom, p_category: newItem.category });
    if (error) return void toast.error(error.message);
    addLine(data as CatalogueItem);
  }
  const setLine = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.item.id === id ? { ...l, ...patch } : l)));

  const ready = !!donor && lines.length > 0 && lines.every((l) => Number(l.quantity) > 0 && Number(l.share) > 0 && Number(l.share) <= Number(l.quantity) && Number(l.unitValue || 0) >= 0);
  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitValue || 0), 0);
  const patients = lines.length ? Math.min(...lines.map((l) => (Number(l.share) > 0 ? Math.floor(Number(l.quantity || 0) / Number(l.share)) : 0))) : 0;

  async function save() {
    if (!donor || !ready) return;
    const summary = lines.map((l) => `${qty(Number(l.quantity))} ${l.item.uom} ${l.item.name}`).join(", ").slice(0, 300);
    const body = {
      performed_by: staffName,
      receipt: {
        donor_id: donor.id,
        valuation_total: Math.round(total * 100) / 100,
        item_summary: summary,
        ar_kind: "dtp",
        received_by: staffName,
        donated_on: donatedOn || null,
        direct_shares: Object.fromEntries(lines.map((l) => [l.item.id, Number(l.share)])),
        direct_note: note.trim() || null,
      },
      lines: lines.map((l) => ({ item_id: l.item.id, quantity: Number(l.quantity), storage_location_id: "loc-receiving", source_type: "donation", source_donor_id: donor.id, unit_cost: Number(l.unitValue || 0) })),
      ledger: { item_description: summary, quantity: lines.reduce((s, l) => s + Number(l.quantity), 0), unit_value: 0, total_value: Math.round(total * 100) / 100 },
    };
    const signature = JSON.stringify(body);
    if (!keys.current.has(signature)) keys.current.set(signature, newDirectKey("dtr"));
    setBusy(true);
    const { data, error } = await inv().rpc("receive_donation", { p: { client_key: keys.current.get(signature), ...body } });
    setBusy(false);
    if (error) return void toast.error(error.message);
    const r = data as { donation_id: string; ar_number: string };
    toast.success(`Received. AR ${r.ar_number} issued.`);
    onSaved(r.donation_id);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Receive a donation for patients</DialogTitle>
          <DialogDescription>It gets its own AR (LAF-DTP) and can only be given to patients, one share each.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <div className="space-y-1.5">
              <Label htmlFor="dtp-donor">Donor</Label>
              {donor ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                  <span className="truncate font-medium">{donor.name}</span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setDonor(null)}>
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <Input id="dtp-donor" value={donorQ} onChange={(e) => setDonorQ(e.target.value)} placeholder="Type the donor's name" autoComplete="off" />
                  {donorQ.trim().length >= 2 ? (
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {donors.map((d) => (
                        <li key={d.id}>
                          <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setDonor(d)}>
                            {d.name}
                          </button>
                        </li>
                      ))}
                      <li className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <span className="text-sm text-muted-foreground">Not in the list?</span>
                        <Select value={donorType} onValueChange={setDonorType}>
                          <SelectTrigger className="h-8 w-36" aria-label="Donor type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="individual">Individual</SelectItem>
                            <SelectItem value="corporate">Company</SelectItem>
                            <SelectItem value="foundation">Foundation</SelectItem>
                            <SelectItem value="government">Government</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button type="button" variant="outline" size="sm" onClick={addDonor}>
                          <Plus className="size-4" /> Add &quot;{donorQ.trim()}&quot;
                        </Button>
                      </li>
                    </ul>
                  ) : null}
                </>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dtp-date">Donated on</Label>
              <Input id="dtp-date" type="date" max={todayManila()} value={donatedOn} onChange={(e) => setDonatedOn(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dtp-item">The goods</Label>
            {lines.map((l) => (
              <div key={l.item.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium">{l.item.name}</p>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.item.name}`} onClick={() => setLines((ls) => ls.filter((x) => x.item.id !== l.item.id))}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`q-${l.item.id}`} className="text-xs text-muted-foreground">
                      How many ({l.item.uom})
                    </Label>
                    <Input id={`q-${l.item.id}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.item.id, { quantity: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`s-${l.item.id}`} className="text-xs text-muted-foreground">
                      Each patient gets
                    </Label>
                    <Input id={`s-${l.item.id}`} inputMode="decimal" value={l.share} onChange={(e) => setLine(l.item.id, { share: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`v-${l.item.id}`} className="text-xs text-muted-foreground">
                      Value each (₱)
                    </Label>
                    <Input id={`v-${l.item.id}`} inputMode="decimal" value={l.unitValue} onChange={(e) => setLine(l.item.id, { unitValue: e.target.value })} placeholder="0" />
                  </div>
                </div>
                {Number(l.share) > Number(l.quantity || 0) && l.quantity ? <p className="mt-1 text-sm text-destructive">One share can&apos;t be more than what was donated.</p> : null}
              </div>
            ))}
            <Input id="dtp-item" value={itemQ} onChange={(e) => setItemQ(e.target.value)} placeholder={lines.length ? "Add another item: type its name" : "Type the item's name, e.g. toy"} autoComplete="off" />
            {itemQ.trim().length >= 2 ? (
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-xl border border-border">
                {cat.items.map((i) => (
                  <li key={i.id}>
                    <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => addLine(i)}>
                      <span>{i.name}</span>
                      <span className="text-muted-foreground">{i.uom}</span>
                    </button>
                  </li>
                ))}
                <li className="space-y-2 px-3 py-2">
                  {newItem ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select value={newItem.uom} onValueChange={(uom) => setNewItem({ ...newItem, uom })}>
                        <SelectTrigger className="h-8 w-28" aria-label="Unit">
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {cat.uoms.map((u) => (
                            <SelectItem key={u} value={u}>
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={newItem.category} onValueChange={(category) => setNewItem({ ...newItem, category })}>
                        <SelectTrigger className="h-8 w-44" aria-label="Category">
                          <SelectValue placeholder="Category" />
                        </SelectTrigger>
                        <SelectContent>
                          {cat.categories.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" size="sm" disabled={!newItem.uom || !newItem.category} onClick={addNewItem}>
                        Add &quot;{itemQ.trim()}&quot;
                      </Button>
                    </div>
                  ) : (
                    <button type="button" className="text-sm text-muted-foreground underline underline-offset-4" onClick={() => setNewItem({ uom: "", category: "" })}>
                      Not in the catalogue? Add &quot;{itemQ.trim()}&quot; as a new item
                    </button>
                  )}
                </li>
              </ul>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dtp-note">Donor&apos;s wish (optional)</Label>
            <Textarea id="dtp-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For the children staying at the house this Christmas" />
          </div>

          {lines.length ? (
            <p className="rounded-xl bg-muted px-3 py-2 text-sm">
              Enough for <strong>{plural(patients, "patient")}</strong>
              {total > 0 ? ` · total value ₱${total.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || !ready} onClick={save}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Receive and issue the AR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
