// Donors > Totals (0095): gift-in-kind batches split food / non-food, plus cash gifts, for a filter.

/** One donated batch logged in LAF Inventory (ops.gik_batches). */
export interface GikBatch {
  receiptId: string;
  date: string;
  donorId: string | null;
  arNumber: string | null;
  bookletArNumber: string | null;
  lines: number;
  food: number;
  nonFood: number;
}

/** One cash gift (ops.donations, kind cash). */
export interface CashGift {
  id: string;
  date: string;
  donorId: string | null;
  reference: string | null;
  amount: number;
  currency: string;
}

export interface GiftRow {
  key: string;
  date: string;
  donorId: string | null;
  kind: "in_kind" | "cash";
  reference: string;
  food: number;
  nonFood: number;
  cash: number;
  /** Not in pesos: listed, left out of the peso totals. */
  currency: string;
}

export interface GiftFilter {
  donorId?: string | null;
  /** Matches the AR number, the booklet AR or the cash gift's reference. */
  query?: string;
}

export interface GiftTotals {
  rows: GiftRow[];
  food: number;
  nonFood: number;
  cash: number;
  total: number;
  /** Cash gifts in another currency, counted apart. */
  otherCurrency: number;
}

export function giftTotals(batches: readonly GikBatch[], cash: readonly CashGift[], filter: GiftFilter = {}): GiftTotals {
  const q = (filter.query ?? "").trim().toLowerCase();
  const keep = (donorId: string | null, refs: (string | null)[]) =>
    (!filter.donorId || donorId === filter.donorId) && (!q || refs.some((r) => (r ?? "").toLowerCase().includes(q)));

  const rows: GiftRow[] = [
    ...batches
      .filter((b) => keep(b.donorId, [b.arNumber, b.bookletArNumber]))
      .map((b) => ({
        key: `gik:${b.receiptId}`,
        date: b.date,
        donorId: b.donorId,
        kind: "in_kind" as const,
        reference: b.arNumber ?? (b.bookletArNumber ? `Booklet ${b.bookletArNumber}` : "No AR yet"),
        food: b.food,
        nonFood: b.nonFood,
        cash: 0,
        currency: "PHP",
      })),
    ...cash
      .filter((c) => keep(c.donorId, [c.reference]))
      .map((c) => ({ key: `cash:${c.id}`, date: c.date, donorId: c.donorId, kind: "cash" as const, reference: c.reference ?? "Cash gift", food: 0, nonFood: 0, cash: c.amount, currency: c.currency })),
  ].sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));

  const peso = rows.filter((r) => r.currency === "PHP");
  const sum = (pick: (r: GiftRow) => number) => Math.round(peso.reduce((s, r) => s + pick(r), 0) * 100) / 100;
  const food = sum((r) => r.food);
  const nonFood = sum((r) => r.nonFood);
  const cashTotal = sum((r) => r.cash);
  return { rows, food, nonFood, cash: cashTotal, total: Math.round((food + nonFood + cashTotal) * 100) / 100, otherCurrency: rows.length - peso.length };
}
