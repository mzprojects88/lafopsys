"use client";

import * as React from "react";
import { Apple, Banknote, Camera, ChevronLeft, ChevronRight, Download, Package, Search, Sigma } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { SectionCard } from "@/components/patterns/section-card";
import { EmptyState } from "@/components/patterns/empty-state";
import { KpiCard, KpiGrid } from "@/components/patterns/kpi-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useDonorsData } from "@/lib/hooks/use-donors-collection";
import { csvLines, downloadCsv } from "@/lib/utils/csv";
import { formatCurrency } from "@/lib/utils/currency";
import { formatDate, todayIso } from "@/lib/utils/date";
import { giftTotals, type GiftRow, type GikBatch } from "@/lib/utils/gift-totals";
import type { Currency } from "@/lib/types/common";
import { periodLabel, periodWindow, shiftAnchor, type DayWindow, type PeriodKind } from "@/lib/utils/period";

type Range = PeriodKind | "custom";
const RANGES: { value: Range; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom" },
];
const ALL = "all";

/**
 * Donors > Totals (0095): what came in for a donor, an AR and a date range -- gifts in kind split
 * into food and non-food by the category each line was received under (LAF Inventory), and cash.
 */
export default function DonationTotalsPage() {
  const { donors, donations, loading: donorsLoading } = useDonorsData();
  const [range, setRange] = React.useState<Range>("month");
  const [anchor, setAnchor] = React.useState(todayIso());
  const [custom, setCustom] = React.useState<DayWindow>(() => periodWindow("month", todayIso()));
  const [donorId, setDonorId] = React.useState<string>(ALL);
  const [query, setQuery] = React.useState("");
  const [photo, setPhoto] = React.useState<GiftRow | null>(null);
  // The answer for one range, kept with its range: a new range shows "Loading" until its own arrives.
  const [result, setResult] = React.useState<{ key: string; batches: GikBatch[] | null; error: string | null }>({ key: "", batches: null, error: null });

  const win: DayWindow = range === "custom" ? custom : periodWindow(range, anchor);
  const { from, to } = win;
  const rangeKey = `${from}|${to}`;
  const batches = result.key === rangeKey ? result.batches : null;
  const error = result.key === rangeKey ? result.error : null;

  React.useEffect(() => {
    if (!from || !to || to < from) return;
    let live = true;
    void createClient()
      .schema("ops")
      .rpc("gik_batches", { p_from: from, p_to: to })
      .then(({ data, error: e }) => {
        if (!live) return;
        if (e) return setResult({ key: `${from}|${to}`, batches: null, error: e.message });
        setResult({
          key: `${from}|${to}`,
          error: null,
          batches: (data ?? []).map((r: Record<string, unknown>) => ({
            receiptId: String(r.receipt_id),
            date: String(r.date),
            donorId: (r.donor_id as string | null) ?? null,
            arNumber: (r.ar_number as string | null) ?? null,
            bookletArNumber: (r.booklet_ar_number as string | null) ?? null,
            lines: Number(r.lines),
            food: Number(r.food_value),
            nonFood: Number(r.nonfood_value),
            hasPhoto: r.has_photo === true,
          })),
        });
      });
    return () => {
      live = false;
    };
  }, [from, to]);

  const cash = React.useMemo(
    () =>
      donations
        .filter((d) => d.kind === "cash" && d.date >= from && d.date <= to)
        .map((d) => ({ id: d.id, date: d.date, donorId: d.donorId || null, reference: d.invoiceNumber ?? null, amount: d.totalValue, currency: d.currency })),
    [donations, from, to]
  );
  const totals = React.useMemo(
    () => giftTotals(batches ?? [], cash, { donorId: donorId === ALL ? null : donorId, query }),
    [batches, cash, donorId, query]
  );

  const donorName = React.useMemo(() => new Map(donors.map((d) => [d.id, d.name])), [donors]);
  const nameOf = (id: string | null) => (id ? (donorName.get(id) ?? "Unknown donor") : "Anonymous donor");
  // Only donors who gave in the range are worth picking.
  const donorOptions = React.useMemo(() => {
    const ids = new Set([...(batches ?? []).map((b) => b.donorId), ...cash.map((c) => c.donorId)].filter((id): id is string => !!id));
    return [...ids].map((id) => ({ id, name: donorName.get(id) ?? "Unknown donor" })).sort((a, b) => a.name.localeCompare(b.name));
  }, [batches, cash, donorName]);

  const label = range === "custom" ? `${formatDate(from)} – ${formatDate(to)}` : periodLabel(range, win);
  const money = (n: number, currency = "PHP") => (n ? formatCurrency(n, currency as Currency) : <span className="text-muted-foreground">—</span>);

  function exportCsv() {
    const rows = totals.rows.map((r) => [r.date, nameOf(r.donorId), r.kind === "cash" ? "Cash" : "In kind", r.reference, String(r.food), String(r.nonFood), String(r.cash), r.currency]);
    downloadCsv(csvLines(["Date", "Donor", "Kind", "AR / reference", "Food items", "Non-food items", "Cash", "Currency"], rows), `donation-totals-${from}-to-${to}.csv`);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Donation totals"
        description="Gifts in kind split into food and non-food items by the category each line was received under in LAF Inventory, and cash gifts, for any donor, AR and date range."
      />

      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as Range)}>
            <SelectTrigger className="w-32" aria-label="Date range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {range === "custom" ? (
            <>
              <Input type="date" aria-label="From" className="w-40" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              <span className="text-theme-sm text-muted-foreground">to</span>
              <Input type="date" aria-label="To" className="w-40" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
            </>
          ) : (
            <span className="flex items-center gap-1">
              <Button type="button" size="icon-sm" variant="outline" aria-label="Previous" onClick={() => setAnchor((a) => shiftAnchor(range, a, -1))}>
                <ChevronLeft />
              </Button>
              <span className="min-w-36 text-center text-theme-sm font-medium">{label}</span>
              <Button type="button" size="icon-sm" variant="outline" aria-label="Next" onClick={() => setAnchor((a) => shiftAnchor(range, a, 1))}>
                <ChevronRight />
              </Button>
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={donorId} onValueChange={setDonorId}>
            <SelectTrigger className="w-full sm:w-72" aria-label="Donor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All donors</SelectItem>
              {donorOptions.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="AR number, booklet AR or cash reference…" aria-label="Search AR" className="pl-10" />
          </div>
        </div>
      </div>

      <KpiGrid>
        <KpiCard label="Food items" value={formatCurrency(totals.food)} icon={Apple} tone="positive" />
        <KpiCard label="Non-food items" value={formatCurrency(totals.nonFood)} icon={Package} />
        <KpiCard label="Cash donations" value={formatCurrency(totals.cash)} icon={Banknote} tone="warning" />
        <KpiCard label="Total" value={formatCurrency(totals.total)} icon={Sigma} sublabel={label} />
      </KpiGrid>

      <SectionCard
        title={`Gifts (${totals.rows.length})`}
        actions={
          totals.rows.length ? (
            <Button size="sm" variant="outline" onClick={exportCsv}>
              <Download /> CSV
            </Button>
          ) : undefined
        }
        flush
      >
        {error ? (
          <p className="px-5 py-4 text-theme-sm text-destructive">{error}</p>
        ) : (batches === null && to >= from) || donorsLoading ? (
          <p className="px-5 py-4 text-theme-sm text-muted-foreground">Loading gifts…</p>
        ) : totals.rows.length === 0 ? (
          <EmptyState icon={Package} title="No gifts match" description="Try another date range, donor or AR number." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-theme-sm">
              <thead className="text-left text-theme-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Donor</th>
                  <th className="px-3 py-2 font-medium">AR / reference</th>
                  <th className="px-3 py-2 text-right font-medium">Food items</th>
                  <th className="px-3 py-2 text-right font-medium">Non-food items</th>
                  <th className="px-5 py-2 text-right font-medium">Cash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {totals.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="px-5 py-2 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-3 py-2">{nameOf(r.donorId)}</td>
                    <td className="px-3 py-2 font-mono text-theme-xs whitespace-nowrap">
                      {r.reference}
                      {r.photoOf ? (
                        <Button type="button" variant="ghost" size="icon-sm" className="ml-1 align-middle" aria-label={`Photo of the goods on ${r.reference}`} onClick={() => setPhoto(r)}>
                          <Camera />
                        </Button>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.food)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.nonFood)}</td>
                    <td className="px-5 py-2 text-right tabular-nums">{money(r.cash, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totals.otherCurrency ? (
              <p className="px-5 py-3 text-theme-xs text-muted-foreground">
                {totals.otherCurrency} cash gift{totals.otherCurrency === 1 ? "" : "s"} in another currency {totals.otherCurrency === 1 ? "is" : "are"} listed but not added to the peso totals.
              </p>
            ) : null}
          </div>
        )}
      </SectionCard>

      {photo ? (
        <Dialog open onOpenChange={(o) => !o && setPhoto(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Photo of the goods</DialogTitle>
              <DialogDescription>
                {photo.reference} · {nameOf(photo.donorId)} · {formatDate(photo.date)}
              </DialogDescription>
            </DialogHeader>
            <img src={`/api/donors/goods-photo/${encodeURIComponent(photo.photoOf!)}`} alt={`The goods received on ${photo.reference}`} className="max-h-[70vh] w-full rounded-lg border border-border bg-muted object-contain" />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
