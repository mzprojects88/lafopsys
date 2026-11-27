// Donations given directly to patients (LAF-DTP, 0082): what the database calls answer, and the small sums the
// screens show. Pure, so tests can run it. The same file lives in LAF Inventory and in ArkOS.

export interface DirectItem {
  itemId: string;
  name: string;
  uom: string;
  /** How many one patient receives. */
  share: number;
  left: number;
  given: number;
  wasted: number;
}

export interface DirectGive {
  id: string;
  /** AR number + the give's number, e.g. LAF-DTP-2026-0001-G07. */
  trace: string;
  shareNo: number;
  givenAt: string;
  givenBy: string | null;
  /** The child's card was scanned; false = picked by name. */
  card: boolean;
  /** Null for staff who can't read Patients: they see the patient number only. */
  patientId: string | null;
  name: string | null;
  caseNumber: string | null;
  items: { name: string; uom: string; quantity: number }[];
  undoneAt: string | null;
  undoReason: string | null;
  undoneBy: string | null;
  replayed?: boolean;
}

export interface DirectDonation {
  id: string;
  arNumber: string;
  date: string;
  donatedOn: string | null;
  donor: string | null;
  receivedBy: string | null;
  note: string | null;
  value: number;
  items: DirectItem[];
  left: number;
  given: number;
  wasted: number;
  /** How many patients the goods are for (the item that runs out first decides). */
  target: number | null;
  served: number;
  firstShares: number;
  extraShares: number;
  lastGivenAt: string | null;
  targetDays: number;
  dueOn: string;
  daysWaiting: number;
  overdue: boolean;
  /** Only when one donation is asked for. */
  gives?: DirectGive[] | null;
}

/** A scanned card or a child picked by name, with each donation that still has goods. */
export interface DirectPatientView {
  status: "active" | "replaced" | "switched_off" | "unknown";
  version?: number;
  card?: boolean;
  patientId?: string;
  caseNumber?: string | null;
  name?: string;
  carer?: string | null;
  donations?: (DirectDonation & { nextShareNo: number; received: { shareNo: number; givenAt: string }[] })[];
}

export const qty = (n: number) => String(Math.round(Number(n) * 1000) / 1000);

/** Given, remaining and written off, as whole percents of everything received that add up to 100. */
export function progress(d: Pick<DirectDonation, "given" | "left" | "wasted">): { total: number; given: number; left: number; wasted: number } {
  const total = Number(d.given) + Number(d.left) + Number(d.wasted);
  if (total <= 0) return { total: 0, given: 0, left: 0, wasted: 0 };
  const given = Math.round((Number(d.given) / total) * 100);
  const wasted = Math.round((Number(d.wasted) / total) * 100);
  return { total, given, wasted, left: Math.max(0, 100 - given - wasted) };
}

/** What one share holds now: each item's share, or what is left of it when less remains. */
export function shareNow(items: DirectItem[]): { name: string; uom: string; quantity: number }[] {
  return items.filter((i) => Number(i.left) > 0).map((i) => ({ name: i.name, uom: i.uom, quantity: Math.min(Number(i.share), Number(i.left)) }));
}

export const itemsLabel = (items: { name: string; uom: string; quantity: number }[]) => items.map((i) => `${qty(i.quantity)} ${i.uom} ${i.name}`).join(", ");

/** A key the database remembers: the same key sent again returns the first result instead of saving twice. */
export function newDirectKey(prefix: "dtg" | "dtr" | "dtu"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A Patient ID card's code (https://…/c/<32 hex>, or the bare code); null for anything else. */
export function directCardToken(text: string): string | null {
  const m = /(?:^|\/c\/)([0-9a-f]{32})(?:[/?#]|$)/.exec(text.trim());
  return m ? m[1]! : null;
}
