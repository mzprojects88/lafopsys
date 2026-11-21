"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, IdCard, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePatientsData } from "@/lib/hooks/use-patients-collection";
import { usePatientCards, idCardsPdfUrl } from "@/lib/hooks/use-patient-cards";
import { useModuleAccess } from "@/lib/hooks/use-module-access";
import { isActiveStay } from "@/lib/utils/beds";
import { formatDate } from "@/lib/utils/date";

type Who = "house" | "ongoing" | "all";
type Has = "any" | "card" | "none";
/** A printed sheet holds at most this many children (the print route's limit): more are split. */
const PER_PDF = 60;
const batches = (ids: string[]) => Array.from({ length: Math.ceil(ids.length / PER_PDF) }, (_, i) => ids.slice(i * PER_PDF, (i + 1) * PER_PDF));

/**
 * Patients > ID cards (0169): find children, issue the cards they lack, then print or download their cards in
 * one go, in the design saved in Settings > Patient ID card.
 */
export function IdCardsBulk() {
  const { patients, stays, loading } = usePatientsData();
  const { activeCard, issue, loading: cardsLoading } = usePatientCards();
  const canEdit = useModuleAccess().canEdit("patients");
  const [who, setWho] = React.useState<Who>("house");
  const [has, setHas] = React.useState<Has>("any");
  const [since, setSince] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);

  const inHouse = React.useMemo(() => new Set(stays.filter(isActiveStay).map((s) => s.patientId)), [stays]);
  const words = search.trim().toLowerCase();
  const rows = patients
    .filter((p) => (who === "house" ? inHouse.has(p.id) : who === "ongoing" ? p.status === "ongoing" : true))
    .map((p) => ({ p, card: activeCard(p.id) }))
    .filter(({ card }) => (has === "card" ? !!card : has === "none" ? !card : true))
    .filter(({ card }) => !since || (!!card && card.issuedAt.slice(0, 10) >= since))
    .filter(({ p }) => !words || `${p.firstName} ${p.lastName} ${p.patientNumber}`.toLowerCase().includes(words))
    .sort((a, b) => `${a.p.lastName} ${a.p.firstName}`.localeCompare(`${b.p.lastName} ${b.p.firstName}`));
  const ids = rows.map((r) => r.p.id).filter((id) => selected.has(id));
  const withCard = ids.filter((id) => activeCard(id));
  const without = ids.filter((id) => !activeCard(id));

  async function issueMissing() {
    setBusy(true);
    let failed = 0;
    for (const id of without) if (!(await issue(id)).ok) failed++;
    setBusy(false);
    if (failed) toast.error(`${failed} card${failed === 1 ? "" : "s"} could not be issued.`);
    else toast.success(`${without.length} card${without.length === 1 ? "" : "s"} issued.`);
  }

  function open(download: boolean) {
    if (!withCard.length) return void toast.error("None of these children has a card yet: issue the cards first.");
    for (const part of batches(withCard)) {
      if (download) {
        const a = document.createElement("a");
        a.href = idCardsPdfUrl(part, true);
        a.download = "LAF-ID-cards.pdf";
        a.click();
      } else window.open(idCardsPdfUrl(part), "_blank", "noopener");
    }
    if (without.length) toast.info(`${without.length} without a card ${without.length === 1 ? "was" : "were"} left out.`);
  }

  const allShown = rows.length > 0 && rows.every((r) => selected.has(r.p.id));
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={who} onValueChange={(v) => setWho(v as Who)}>
          <TabsList>
            <TabsTrigger value="house">In the house tonight</TabsTrigger>
            <TabsTrigger value="ongoing">Ongoing</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>
        </Tabs>
        <Tabs value={has} onValueChange={(v) => setHas(v as Has)}>
          <TabsList>
            <TabsTrigger value="any">Any</TabsTrigger>
            <TabsTrigger value="card">Has a card</TabsTrigger>
            <TabsTrigger value="none">No card yet</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="flex items-center gap-2 text-theme-sm">
          Issued since
          <Input type="date" className="h-9 w-40" value={since} onChange={(e) => setSince(e.target.value)} aria-label="Card issued since" />
        </label>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or LFCN" aria-label="Search by name or LFCN" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex items-center gap-2 text-theme-sm">
          <Checkbox checked={allShown} onCheckedChange={() => setSelected(allShown ? new Set() : new Set(rows.map((r) => r.p.id)))} aria-label="Select every child shown" />
          {ids.length ? `${ids.length} selected · ${withCard.length} with a card` : `${rows.length} shown`}
        </label>
        {canEdit ? (
          <Button variant="outline" disabled={busy || without.length === 0} onClick={() => void issueMissing()}>
            <IdCard className="size-4" /> {busy ? "Issuing…" : `Issue missing cards${without.length ? ` (${without.length})` : ""}`}
          </Button>
        ) : null}
        <Button disabled={withCard.length === 0} onClick={() => open(false)}>
          <Printer className="size-4" /> Print{withCard.length ? ` (${withCard.length})` : ""}
        </Button>
        <Button variant="outline" disabled={withCard.length === 0} onClick={() => open(true)}>
          <Download className="size-4" /> Download PDF
        </Button>
      </div>
      {withCard.length > PER_PDF ? <p className="text-theme-xs text-muted-foreground">More than {PER_PDF} children: the cards come as {batches(withCard).length} PDFs.</p> : null}

      {loading || cardsLoading ? <p className="text-theme-sm text-muted-foreground">Loading the children…</p> : null}
      {!loading && rows.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-theme-sm text-muted-foreground">No child matches these filters.</p> : null}
      <ul className="flex flex-col divide-y divide-border">
        {rows.map(({ p, card }) => (
          <li key={p.id} className="flex min-h-12 flex-wrap items-center gap-3 py-2">
            <Checkbox
              checked={selected.has(p.id)}
              onCheckedChange={(v) =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (v === true) next.add(p.id);
                  else next.delete(p.id);
                  return next;
                })
              }
              aria-label={`Select ${p.firstName} ${p.lastName}`}
            />
            <Link href={`/patients/${p.id}`} className="min-w-40 flex-1 font-medium hover:underline">
              {p.firstName} {p.lastName}
              <span className="ml-2 text-theme-xs font-normal text-muted-foreground">{p.patientNumber}</span>
            </Link>
            {inHouse.has(p.id) ? <span className="rounded-md border border-border px-1.5 text-theme-xs text-muted-foreground">In the house</span> : null}
            <span className={card ? "text-theme-xs text-success-foreground dark:text-success" : "text-theme-xs text-muted-foreground"}>
              {card ? `Card ${card.version} · issued ${formatDate(card.issuedAt)}` : "No card yet"}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-theme-xs text-muted-foreground">
        The cards print in the design saved in <span className="font-medium">Settings › Patient ID card</span>.{" "}
        {canEdit ? null : "Issuing cards needs Patients edit."}
      </p>
    </div>
  );
}
