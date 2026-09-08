"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import { parseDueRule } from "@/lib/utils/compliance";
import type { ComplianceApplies, ComplianceCategory, ComplianceFiling, ComplianceFilingStatus, ComplianceFrequency, ComplianceItem } from "@/lib/types/hr";

interface ItemRow {
  id: string;
  code: string;
  agency: string;
  name: string;
  form: string | null;
  category: ComplianceCategory;
  frequency: ComplianceFrequency;
  due_rule: unknown;
  applies: ComplianceApplies;
  active: boolean;
  portal_url: string | null;
  notes: string | null;
  sort_order: number;
}

export function toComplianceItem(r: ItemRow): ComplianceItem {
  let dueRule: ComplianceItem["dueRule"];
  try {
    dueRule = parseDueRule(r.due_rule);
  } catch {
    dueRule = { kind: "as_needed" };
  }
  return { id: r.id, code: r.code, agency: r.agency, name: r.name, form: r.form, category: r.category, frequency: r.frequency, dueRule, applies: r.applies, active: r.active, portalUrl: r.portal_url, notes: r.notes, sortOrder: r.sort_order };
}

/** The obligations (hr.compliance_items, 0043), in the workbook's order. Readable by all staff. */
export const complianceItemsStore = createCollection<ComplianceItem[]>({
  key: "hr.compliance_items",
  empty: [],
  tables: [{ schema: "hr", table: "compliance_items" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("compliance_items").select("*").order("sort_order");
    if (error) throw new Error(error.message);
    return ((data ?? []) as ItemRow[]).map(toComplianceItem);
  },
});

export function useComplianceItems() {
  const { data: items, loading, error } = useCollection(complianceItemsStore);
  return { items, loading, error };
}

interface FilingRow {
  id: string;
  item_id: string;
  period_key: string;
  due_on: string;
  status: ComplianceFilingStatus;
  filed_on: string | null;
  reference_no: string | null;
  amount: string | number | null;
  attachment_url: string | null;
  notes: string | null;
  filed_by: string | null;
  updated_at: string;
}

export function toComplianceFiling(r: FilingRow): ComplianceFiling {
  return {
    id: r.id,
    itemId: r.item_id,
    periodKey: r.period_key,
    dueOn: r.due_on,
    status: r.status,
    filedOn: r.filed_on,
    referenceNo: r.reference_no,
    amount: r.amount === null ? null : Number(r.amount),
    attachmentUrl: r.attachment_url,
    notes: r.notes,
    filedBy: r.filed_by,
    updatedAt: r.updated_at,
  };
}

/** What has been filed (HR only; RLS returns nothing to others). */
export const complianceFilingsStore = createCollection<ComplianceFiling[]>({
  key: "hr.compliance_filings",
  empty: [],
  tables: [{ schema: "hr", table: "compliance_filings" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("compliance_filings").select("*").order("due_on", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as FilingRow[]).map(toComplianceFiling);
  },
});

export function useComplianceFilings() {
  const { data: filings, loading, error } = useCollection(complianceFilingsStore);
  return { filings, loading, error };
}
