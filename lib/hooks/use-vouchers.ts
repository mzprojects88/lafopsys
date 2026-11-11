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
  voucherType: "PV" | "PCV" | "GCV" | "JV" | null;
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
  /** Why a voucher from the registers needs cleaning up (0136). */
  cleanupReasons: string[];
  /** Paid to a person (0135): their category and name as given (a patient picked, or typed). */
  toPerson: boolean;
  recipientCategoryId: string | null;
  patientId: string | null;
  recipientName: string | null;
  /** 0138: the advance a liquidation settles; the top-up that refills a slip; what Finance withheld. */
  advanceOf: string | null;
  replenishedBy: string | null;
  ewtTotal: number;
  /** 0139: paid from (a cash or bank account), the check or transfer reference, when paid, exported, the bank debit. */
  paidFromAccountId: string | null;
  payReference: string | null;
  releasedAt: string | null;
  exportedAt: string | null;
  bankTransactionId: string | null;
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
  ewtAtc: string | null;
  ewtRate: number | null;
  ewtAmount: number;
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
  cleanupReasons: (r.cleanup_reasons as string[] | null) ?? [],
  toPerson: Boolean(r.to_person),
  recipientCategoryId: s(r.recipient_category_id),
  patientId: s(r.patient_id),
  recipientName: s(r.recipient_name),
  advanceOf: s(r.advance_of),
  replenishedBy: s(r.replenished_by),
  ewtTotal: num(r.ewt_total),
  paidFromAccountId: s(r.paid_from_account_id),
  payReference: s(r.pay_reference),
  releasedAt: s(r.released_at),
  exportedAt: s(r.exported_at),
  bankTransactionId: s(r.bank_transaction_id),
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
    ewtAtc: s(r.ewt_atc), ewtRate: r.ewt_rate == null ? null : num(r.ewt_rate), ewtAmount: num(r.ewt_amount),
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

/** A list a database function returns, refetched when vouchers, their events or the settings change. */
const rpcStore = <T>(fn: string, map: (r: Row) => T, tables: string[]) =>
  createCollection<T[]>({
    key: `ops.${fn}`,
    empty: [],
    tables: tables.map((table) => ({ schema: "ops", table })),
    fetch: async () => {
      const { data, error } = await createClient().schema("ops").rpc(fn);
      if (error) throw new Error(error.message);
      return ((data ?? []) as Row[]).map(map);
    },
  });
export interface FundStatus { fundId: string; name: string; kind: "petty_cash" | "gcash"; float: number | null; topUpBelow: number | null; custodianId: string | null; openCount: number; openAmount: number; cashOnHand: number; toRefill: number; topUpPending: boolean; low: boolean }
export interface OpenAdvance { voucherId: string; requestedBy: string; amount: number; releasedAt: string; due: string; overdue: boolean; liquidationId: string | null; liquidationStatus: string | null }
/** Each fund's cash on hand and open slips (ops.fund_status): Finance's viewers and the fund's custodian. */
export const fundStatusStore = rpcStore<FundStatus>("fund_status", (r) => ({
  fundId: String(r.fund_id), name: String(r.name), kind: r.kind as FundStatus["kind"], float: r.float_amount == null ? null : num(r.float_amount),
  topUpBelow: r.top_up_below == null ? null : num(r.top_up_below), custodianId: s(r.custodian_staff_id), openCount: num(r.open_count), openAmount: num(r.open_amount),
  cashOnHand: num(r.cash_on_hand), toRefill: num(r.to_refill), topUpPending: Boolean(r.topup_pending), low: Boolean(r.low),
}), ["vouchers", "cash_funds"]);
/** Approved advances not yet settled (ops.advances_open): one's own; all of them for Finance's viewers. */
export const advancesOpenStore = rpcStore<OpenAdvance>("advances_open", (r) => ({
  voucherId: String(r.voucher_id), requestedBy: String(r.requested_by), amount: num(r.amount), releasedAt: String(r.released_at), due: String(r.due),
  overdue: Boolean(r.overdue), liquidationId: s(r.liquidation_id), liquidationStatus: s(r.liquidation_status),
}), ["vouchers", "finance_settings"]);

export function useVouchers() {
  const { data: vouchers, loading } = useCollection(vouchersStore);
  const { data: lines, loading: linesLoading } = useCollection(voucherLinesStore);
  const { data: events } = useCollection(voucherEventsStore);
  const { data: queue } = useCollection(voucherQueueStore);
  return { vouchers, lines, events, queue, loading, linesLoading };
}

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };
const refresh = () =>
  Promise.all([vouchersStore.refetch(), voucherLinesStore.refetch(), voucherEventsStore.refetch(), voucherQueueStore.refetch(), fundStatusStore.refetch(), advancesOpenStore.refetch()]);

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
  pay_method: Voucher["payMethod"];
  needed_by: string | null;
  urgent: boolean;
  urgent_reason: string | null;
  to_person: boolean;
  recipient_category_id: string | null;
  patient_id: string | null;
  recipient_name: string | null;
}
/** Saves a draft (new when id is null); returns its id. */
export const saveVoucher = (id: string | null, header: DraftHeader, lines: DraftLine[]) => call<string>("voucher_save", { p_id: id, p_voucher: header, p_lines: lines });
/** submit, endorse, review, approve, return, reject, cancel or discard; returns the new status. */
export const actOnVoucher = (id: string, action: string, note?: string) => call<string>("voucher_act", { p_id: id, p_action: action, p_note: note ?? null });
/** Finance prepares: the fund, the employee code and each line's coding; returns the voucher number. */
export const prepareVoucher = (id: string, t2Id: string, t4StaffId: string | null, lines: { id: string; account_id: string | null; t1_id: string | null; t3_id: string | null }[], note?: string, payeeId?: string | null) =>
  call<string>("voucher_prepare", { p_id: id, p_t2: t2Id, p_t4_staff: t4StaffId, p_lines: lines, p_note: note ?? null, p_payee: payeeId ?? null });
/** A payment step (0139): prepare the payment (from an account, with its reference), approve it, or release it. */
export const payVoucher = (id: string, action: "prepare_payment" | "approve_payment" | "release", accountId?: string | null, reference?: string, note?: string) =>
  call<string>("voucher_pay", { p_id: id, p_action: action, p_account: accountId ?? null, p_reference: reference ?? null, p_note: note ?? null });
/** Finance links a paid voucher to its bank debit (null unlinks it). */
export const matchToBank = (id: string, transactionId: string | null) => call<null>("voucher_bank_match", { p_id: id, p_tx: transactionId });
export interface JournalRow { voucher_id: string; journal_no: string; journal_date: string; account: string; debit: number | null; credit: number | null; description: string; name: string; class: string | null; already_exported: boolean }
/** The QuickBooks journal for vouchers paid between two days (the export power); with mark, they are marked exported. */
export async function quickBooksJournal(from: string, to: string, mark: boolean): Promise<Result<JournalRow[]>> {
  const { data, error } = await createClient().schema("ops").rpc("voucher_qb_export", { p_from: from, p_to: to, p_mark: mark });
  if (error) return { ok: false, error: error.message };
  if (mark) await vouchersStore.refetch();
  return { ok: true, value: (data ?? []) as JournalRow[] };
}
/** The requester starts liquidating their approved advance: a draft with its lines; returns the new id. */
export const liquidateAdvance = (advanceId: string) => call<string>("voucher_liquidate", { p_advance: advanceId });
/** Finance or the custodian asks for a fund's top-up from its open slips; returns the draft's id. */
export const createTopUp = (fundId: string) => call<string>("fund_topup_create", { p_fund: fundId });
/** Finance corrects a voucher from the registers (0136): the fund and each line's coding; true once it is clean. */
export const fixHistory = (id: string, t2Id: string | null, lines: { id: string; account_id: string | null; t1_id: string | null; t3_id: string | null }[], note?: string, othersChecked = false) =>
  call<boolean>("voucher_fix_history", { p_id: id, p_t2: t2Id, p_lines: lines, p_note: note ?? null, p_others_checked: othersChecked });
/** How many other live requests look like this one (same OR number, or same payee and total within 30 days). */
export async function similarCount(id: string): Promise<number> {
  const { data } = await createClient().schema("ops").rpc("voucher_similar", { p_id: id });
  return Number(data ?? 0);
}
