"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { fetchAll } from "@/lib/supabase/fetch-all";
import type { TrackEvent, VoucherAction, VoucherKind, VoucherStatus } from "@/lib/utils/vouchers";

/**
 * Payment requests and vouchers (0134), as far as the database lets the person read them (their own; Finance and
 * the signers once sent). Every change goes through the database's functions, which apply Financial Settings.
 */
export interface Voucher {
  id: string;
  requestNumber: string | null;
  voucherType: "PV" | "PCV" | "GCV" | null;
  voucherNumber: string | null;
  kind: VoucherKind;
  status: VoucherStatus;
  purpose: string;
  requestedBy: string | null;
  requesterRole: string | null;
  payeeId: string | null;
  fundId: string | null;
  t2Id: string | null;
  t4StaffId: string | null;
  t4Code: string | null;
  payMethod: "cash" | "check" | "bank_transfer" | "gcash";
  neededBy: string | null;
  urgent: boolean;
  urgentReason: string | null;
  total: number;
  submittedAt: string | null;
  source: "app" | "sheet";
  legacyNumber: string | null;
  legacyLink: string | null;
  payeeText: string | null;
  needsCleanup: boolean;
  createdAt: string;
}
export interface VoucherLine {
  id: string;
  voucherId: string;
  sort: number;
  description: string;
  qty: number;
  unitCost: number;
  amount: number;
  orNumber: string | null;
  expenseTypeId: string | null;
  accountId: string | null;
  t1Id: string | null;
  t3Id: string | null;
  legacyCode: string | null;
}
export interface VoucherEvent extends TrackEvent {
  id: string;
  voucherId: string;
  action: VoucherAction;
  fromStatus: string | null;
  toStatus: string | null;
  signerText: string | null;
}
export interface VoucherFile {
  id: string;
  voucherId: string;
  kind: "receipt" | "invoice" | "quotation" | "other";
  fileName: string;
  contentType: string;
  bytes: number;
  uploadedBy: string | null;
  uploadedAt: string;
}

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => Number(v ?? 0);

const toVoucher = (r: Row): Voucher => ({
  id: String(r.id),
  requestNumber: s(r.request_number),
  voucherType: r.voucher_type as Voucher["voucherType"],
  voucherNumber: s(r.voucher_number),
  kind: r.kind as VoucherKind,
  status: r.status as VoucherStatus,
  purpose: String(r.purpose),
  requestedBy: s(r.requested_by),
  requesterRole: s(r.requester_role),
  payeeId: s(r.payee_id),
  fundId: s(r.fund_id),
  t2Id: s(r.t2_id),
  t4StaffId: s(r.t4_staff_id),
  t4Code: s(r.t4_code),
  payMethod: r.pay_method as Voucher["payMethod"],
  neededBy: s(r.needed_by),
  urgent: Boolean(r.urgent),
  urgentReason: s(r.urgent_reason),
  total: num(r.total),
  submittedAt: s(r.submitted_at),
  source: r.source as Voucher["source"],
  legacyNumber: s(r.legacy_number),
  legacyLink: s(r.legacy_link),
  payeeText: s(r.payee_text),
  needsCleanup: Boolean(r.needs_cleanup),
  createdAt: String(r.created_at),
});

const all = <T>(table: string, order: string, map: (r: Row) => T) => async () => {
  const rows = await fetchAll<Row>((from, to) => createClient().schema("ops").from(table).select("*").order(order).order("id").range(from, to));
  return rows.map(map);
};

export const vouchersStore = createCollection<Voucher[]>({
  key: "ops.vouchers",
  empty: [],
  tables: [{ schema: "ops", table: "vouchers" }],
  fetch: all("vouchers", "created_at", toVoucher),
});
export const voucherLinesStore = createCollection<VoucherLine[]>({
  key: "ops.voucher_lines",
  empty: [],
  tables: [{ schema: "ops", table: "voucher_lines" }],
  fetch: all("voucher_lines", "sort", (r) => ({
    id: String(r.id), voucherId: String(r.voucher_id), sort: num(r.sort), description: String(r.description), qty: num(r.qty), unitCost: num(r.unit_cost),
    amount: num(r.amount), orNumber: s(r.or_number), expenseTypeId: s(r.expense_type_id), accountId: s(r.account_id), t1Id: s(r.t1_id), t3Id: s(r.t3_id), legacyCode: s(r.legacy_code),
  })),
});
export const voucherEventsStore = createCollection<VoucherEvent[]>({
  key: "ops.voucher_events",
  empty: [],
  tables: [{ schema: "ops", table: "voucher_events" }],
  fetch: all("voucher_events", "at", (r) => ({
    id: String(r.id), voucherId: String(r.voucher_id), action: r.action as VoucherAction, fromStatus: s(r.from_status), toStatus: s(r.to_status),
    actor: s(r.actor), signerText: s(r.signer_text), note: s(r.note), at: String(r.at),
  })),
});
export const voucherFilesStore = createCollection<VoucherFile[]>({
  key: "ops.voucher_files",
  empty: [],
  tables: [{ schema: "ops", table: "voucher_files" }],
  fetch: all("voucher_files", "uploaded_at", (r) => ({
    id: String(r.id), voucherId: String(r.voucher_id), kind: r.kind as VoucherFile["kind"], fileName: String(r.file_name), contentType: String(r.content_type),
    bytes: num(r.bytes), uploadedBy: s(r.uploaded_by), uploadedAt: String(r.uploaded_at),
  })),
});
/** What waits for this person (ops.voucher_queue): steps they may sign, by the rule the database signs by, and
 * their own requests sent back to them (step "returned"). */
export const voucherQueueStore = createCollection<{ voucherId: string; step: string }[]>({
  key: "ops.voucher_queue",
  empty: [],
  tables: [{ schema: "ops", table: "vouchers" }, { schema: "ops", table: "voucher_events" }, { schema: "ops", table: "voucher_authority" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("ops").rpc("voucher_queue");
    if (error) throw new Error(error.message);
    return ((data ?? []) as { voucher_id: string; step: string }[]).map((r) => ({ voucherId: r.voucher_id, step: r.step }));
  },
});

export function useVouchers() {
  const { data: vouchers, loading } = useCollection(vouchersStore);
  const { data: lines, loading: linesLoading } = useCollection(voucherLinesStore);
  const { data: events } = useCollection(voucherEventsStore);
  const { data: queue } = useCollection(voucherQueueStore);
  return { vouchers, lines, events, queue, loading, linesLoading };
}

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };
const refresh = () => Promise.all([vouchersStore.refetch(), voucherLinesStore.refetch(), voucherEventsStore.refetch(), voucherQueueStore.refetch()]);

async function call<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  const { data, error } = await createClient().schema("ops").rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  await refresh();
  return { ok: true, value: data as T };
}

export interface DraftLine {
  description: string;
  qty: number;
  unit_cost: number;
  or_number: string;
  expense_type_id: string;
}
export interface DraftHeader {
  kind: VoucherKind;
  purpose: string;
  payee_id: string | null;
  t2_id: string;
  pay_method: Voucher["payMethod"];
  needed_by: string | null;
  urgent: boolean;
  urgent_reason: string | null;
}
/** Saves a draft (new when id is null); returns its id. */
export const saveVoucher = (id: string | null, header: DraftHeader, lines: DraftLine[]) => call<string>("voucher_save", { p_id: id, p_voucher: header, p_lines: lines });
/** submit, endorse, review, approve, return, reject, cancel or discard; returns the new status. */
export const actOnVoucher = (id: string, action: string, note?: string) => call<string>("voucher_act", { p_id: id, p_action: action, p_note: note ?? null });
/** Finance prepares: the fund, the employee code and each line's coding; returns the voucher number. */
export const prepareVoucher = (id: string, t2Id: string, t4StaffId: string | null, lines: { id: string; account_id: string | null; t1_id: string | null; t3_id: string | null }[], note?: string) =>
  call<string>("voucher_prepare", { p_id: id, p_t2: t2Id, p_t4_staff: t4StaffId, p_lines: lines, p_note: note ?? null });
/** How many other live requests look like this one (same OR number, or same payee and total within 30 days). */
export async function similarCount(id: string): Promise<number> {
  const { data } = await createClient().schema("ops").rpc("voucher_similar", { p_id: id });
  return Number(data ?? 0);
}
