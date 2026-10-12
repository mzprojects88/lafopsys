"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Banknote, CheckCheck, Sparkles, UserSearch } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { useCashGifts, type NameDecision } from "@/lib/hooks/use-cash-gifts";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { useNow } from "@/lib/hooks/use-now";
import type { DonorType } from "@/lib/types/donor";
import { CASH_SOURCE_LABEL, TRACKER_STALE_MS, cashProgress, namesToConfirm, type CashSource, type NameToConfirm } from "@/lib/utils/cash-gifts";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, formatRelative } from "@/lib/utils/date";
import { checkNamesWithAi } from "./actions";

const TYPES: DonorType[] = ["individual", "corporate", "foundation", "government", "anonymous"];
const typeLabel = (t: string) => t[0]!.toUpperCase() + t.slice(1);
const gifts = (n: number) => `${n} gift${n === 1 ? "" : "s"}`;
const SOURCES: CashSource[] = ["2026", "2025", "2024", "2025_noncash"];

/** A row starts over when its proposal changes (an AI hint arrived, a donor was added). */
const rowKey = (n: NameToConfirm) => `${n.nameKey}|${JSON.stringify(n.proposal)}`;

/** A row's decision as the rules propose it. */
const proposed = (n: NameToConfirm): NameDecision => ("donorId" in n.proposal ? { nameKey: n.nameKey, donorId: n.proposal.donorId } : { nameKey: n.nameKey, ...n.proposal });

/**
 * Donors > Cash gifts: accounting's sheets, read into the app (0084). Each sheet name is confirmed
 * once by a donors editor (an existing donor, a new one, or not a donor); the database then posts
 * that name's gifts, now and at every later read of the sheet.
 */
export default function CashGiftsPage() {
  const { donors } = useDonorsData();
  const { lines, decided, hints, sources, loading, decide } = useCashGifts();
  const { canEdit } = useModuleAccess();
  const editor = canEdit("donors");
  const [busy, setBusy] = React.useState(false);
  const now = useNow();

  const [checking, startChecking] = React.useTransition();
  const names = React.useMemo(() => namesToConfirm(lines, donors, decided, hints), [lines, donors, decided, hints]);
  // New names whose type nothing has settled yet: no clear word in the name and no AI hint.
  const unchecked = names.filter((n) => n.typedBy === "rule").length;

  function checkWithAi() {
    startChecking(async () => {
      const r = await checkNamesWithAi();
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.checked ? `${r.checked} name${r.checked === 1 ? "" : "s"} checked. Types marked AI are suggestions: change any that are wrong.` : "Every name was already checked.");
    });
  }
  const progress = React.useMemo(() => cashProgress(lines, decided), [lines, decided]);
  const look = names.filter((n) => !n.ready);
  const ready = names.filter((n) => n.ready);
  const tracker = sources.find((s) => s.source === "2026");
  const stale = tracker ? now.getTime() - Date.parse(tracker.receivedAt) > TRACKER_STALE_MS : false;

  async function confirm(decisions: NameDecision[]) {
    setBusy(true);
    let posted = 0;
    // The database takes 500 decisions a call.
    for (let i = 0; i < decisions.length; i += 500) {
      const r = await decide(decisions.slice(i, i + 500));
      if (!r.ok) {
        setBusy(false);
        return void toast.error(r.error);
      }
      posted += r.posted ?? 0;
    }
    setBusy(false);
    toast.success(posted ? `${gifts(posted)} added to the donor list.` : "Saved.");
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title="Cash gifts"
        description="Cash donations from accounting's sheets. Confirm a name once; its gifts then join the donor list by themselves, now and each time the sheet is read."
        action={
          <>
            <Button variant="outline" asChild>
              <Link href="/donors">All donors</Link>
            </Button>
            {editor && unchecked > 0 && (
              <Button onClick={checkWithAi} disabled={checking}>
                <Sparkles />
                {checking ? "Checking… (up to a minute)" : `Check ${unchecked} names with AI`}
              </Button>
            )}
          </>
        }
      />

      {!loading && lines.length === 0 ? (
        <EmptyState title="No cash gifts have been read yet" description="They arrive from accounting's Donation Tracker every hour, once the tracker's script is set up." />
      ) : (
        <SectionCard title={<span className="flex items-center gap-2"><Banknote className="size-4 text-muted-foreground" />The sheets</span>} flush>
          <ul className="flex flex-col divide-y divide-border">
            {SOURCES.filter((s) => sources.some((x) => x.source === s)).map((s) => {
              const status = sources.find((x) => x.source === s)!;
              const p = progress[s];
              return (
                <li key={s} className="flex flex-col gap-1 px-5 py-3 text-theme-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="font-medium">{CASH_SOURCE_LABEL[s]}</span>
                    <span className="text-theme-xs text-muted-foreground">
                      {s === "2026" ? `Read every hour · last ${formatRelative(status.receivedAt)}` : `Read once, ${formatDate(status.receivedAt.slice(0, 10))}`}
                    </span>
                  </div>
                  <p className="text-theme-xs text-muted-foreground">
                    <span className="text-foreground">{gifts(p.posted.gifts)} · {formatCurrency(p.posted.total)}</span> in the donor list
                    {p.waiting.gifts > 0 && <> · <span className="text-warning-foreground dark:text-warning">{gifts(p.waiting.gifts)} · {formatCurrency(p.waiting.total)} waiting for a name</span></>}
                    {p.leftOut.gifts > 0 && <> · {gifts(p.leftOut.gifts)} · {formatCurrency(p.leftOut.total)} left out (not a donor)</>}
                  </p>
                  {s === "2026" && stale && (
                    <p className="flex items-start gap-1.5 text-theme-xs text-warning-foreground dark:text-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      Nothing has arrived from the tracker since {formatRelative(status.receivedAt)}. Its hourly script may have stopped; newer gifts are not here yet.
                    </p>
                  )}
                  {status.problems.map((problem) => (
                    <p key={problem} className="flex items-start gap-1.5 text-theme-xs text-warning-foreground dark:text-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {problem} Fix it on the sheet; it is read again within the hour.
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}

      {!loading && lines.length > 0 && names.length === 0 && <EmptyState title="Every name is confirmed" description="New names on the tracker will wait here for you." />}

      {look.length > 0 && (
        <SectionCard
          title={<span className="flex items-center gap-2"><UserSearch className="size-4 text-muted-foreground" />Check these first ({look.length})</span>}
          description="A name close to a donor already on the list or to another name here, only a first name, or not a name at all. Choose who it is."
        >
          <ul className="flex flex-col divide-y divide-border">
            {look.map((n) => <NameRow key={rowKey(n)} n={n} editor={editor} busy={busy} confirm={confirm} />)}
          </ul>
        </SectionCard>
      )}

      {ready.length > 0 && (
        <SectionCard
          title={<span className="flex items-center gap-2"><CheckCheck className="size-4 text-muted-foreground" />Ready to confirm ({ready.length})</span>}
          description={`The same name as one donor on the list, or a new, full name that resembles no other.${unchecked > 0 ? " Check the names with AI first: it tells companies and organisations from people." : ""}`}
          actions={
            editor ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" disabled={busy}>Confirm all {ready.length}</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirm {ready.length} names as shown?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {ready.filter((n) => !("donorId" in n.proposal)).length} become new donors, written as shown; {ready.filter((n) => "donorId" in n.proposal).length} go to the donor of the same name.
                      Their {gifts(ready.reduce((s, n) => s + n.gifts, 0))} ({formatCurrency(ready.reduce((s, n) => s + n.total, 0))}) join the donor list. A name or type you edited in a row is used only if you confirm that row itself first.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Not now</AlertDialogCancel>
                    <AlertDialogAction onClick={() => confirm(ready.map(proposed))}>Confirm them</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null
          }
        >
          <ul className="flex flex-col divide-y divide-border">
            {ready.map((n) => <NameRow key={rowKey(n)} n={n} editor={editor} busy={busy} confirm={confirm} />)}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

function NameRow({ n, editor, busy, confirm }: { n: NameToConfirm; editor: boolean; busy: boolean; confirm: (d: NameDecision[]) => Promise<unknown> }) {
  const start = "donorId" in n.proposal ? n.proposal.donorId : "new";
  const fresh = "donorId" in n.proposal ? null : n.proposal;
  const [goesTo, setGoesTo] = React.useState(start);
  const [name, setName] = React.useState(fresh?.name ?? n.sheetName);
  const [type, setType] = React.useState<DonorType>(fresh?.type ?? "individual");

  const decision = (): NameDecision =>
    goesTo === "skip" ? { nameKey: n.nameKey, skip: true } : goesTo === "new" ? { nameKey: n.nameKey, name: name.trim(), salutation: fresh?.salutation ?? null, type } : { nameKey: n.nameKey, donorId: goesTo };

  return (
    <li className="flex flex-col gap-2 py-3 text-theme-sm">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{n.sheetName}</span>
        <span className="text-theme-xs text-muted-foreground">
          {gifts(n.gifts)} · {formatCurrency(n.total)} · {n.firstDate === n.lastDate ? formatDate(n.firstDate) : `${formatDate(n.firstDate)} – ${formatDate(n.lastDate)}`} · {n.sources.map((s) => CASH_SOURCE_LABEL[s]).join(", ")}
        </span>
      </div>
      {n.lookAlikes.length > 0 && <p className="text-theme-xs text-muted-foreground">Also on the sheets: {n.lookAlikes.map((x) => `“${x}”`).join(", ")}. If it is the same donor, confirm one as new, then choose that donor for the other.</p>}
      {n.candidates.filter((c) => c.same).length > 1 && <p className="text-theme-xs text-muted-foreground">Two donors on the list have this name. Merge them in Clean-up, or choose one here.</p>}
      {n.notes.map((note) => <p key={note} className="text-theme-xs text-muted-foreground">{note}</p>)}
      {editor ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={goesTo} onValueChange={setGoesTo}>
            <SelectTrigger className="w-72 max-w-full" aria-label={`Who ${n.sheetName} is`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {n.candidates.map(({ donor, same }) => (
                <SelectItem key={donor.id} value={donor.id}>{donor.name} · {gifts(donor.giftCount)} ({same ? "same name" : "similar"})</SelectItem>
              ))}
              <SelectItem value="new">New donor</SelectItem>
              <SelectItem value="skip">Not a donor (leave out)</SelectItem>
            </SelectContent>
          </Select>
          {goesTo === "new" && (
            <>
              <Input className="w-64 max-w-full" value={name} onChange={(e) => setName(e.target.value)} aria-label={`Donor name for ${n.sheetName}`} />
              <Select value={type} onValueChange={(v) => setType(v as DonorType)}>
                <SelectTrigger className="w-36" aria-label="Donor type"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}</SelectContent>
              </Select>
              {n.typedBy === "ai" && type === fresh?.type && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary" title="The AI suggested this type. Change it if it is wrong.">
                  <Sparkles className="size-3" />
                  AI
                </span>
              )}
            </>
          )}
          <Button size="sm" variant="outline" disabled={busy || (goesTo === "new" && name.trim().length < 2)} onClick={() => confirm([decision()])}>Confirm</Button>
        </div>
      ) : (
        <p className="text-theme-xs text-muted-foreground">Waiting for a donors editor to confirm the name.</p>
      )}
    </li>
  );
}
