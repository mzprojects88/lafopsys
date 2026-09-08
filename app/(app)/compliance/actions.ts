"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseDueRule } from "@/lib/utils/compliance";
import type { ComplianceApplies, ComplianceCategory, ComplianceFilingStatus, ComplianceFrequency } from "@/lib/types/hr";
import type { ActionResult } from "../actions";

/** Same shape as app/(app)/hr/actions.ts hrCaller: RLS is the gate, this is the readable refusal. */
async function hrCaller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." as string, supabase: undefined, userId: undefined };
  const { data: staff } = await supabase.schema("shared").from("staff").select("role, is_hr, active").eq("id", user.id).single();
  if (!staff?.active || !(staff.role === "admin" || staff.is_hr)) return { error: "Only admins and HR can do this." as string, supabase: undefined, userId: undefined };
  return { error: undefined, supabase, userId: user.id };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}(-\d{2}|-Q[1-4])?$/;
const done = () => {
  revalidatePath("/hr/compliance");
  revalidatePath("/hr");
};

export interface FilingInput {
  itemId: string;
  periodKey: string;
  dueOn: string;
  status: ComplianceFilingStatus;
  filedOn: string | null;
  referenceNo: string;
  amount: number | null;
  attachmentUrl: string;
  notes: string;
}

/** Records the state of one obligation for one period: in progress, filed with its reference, or not applicable. */
export async function saveComplianceFiling(input: FilingInput): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  if (!PERIOD_RE.test(input.periodKey)) return { ok: false, error: "Bad period key." };
  if (!DATE_RE.test(input.dueOn)) return { ok: false, error: "Bad due date." };
  if (input.status === "filed" && !(input.filedOn && DATE_RE.test(input.filedOn))) return { ok: false, error: "Give the date it was filed." };
  if (input.amount !== null && !(Number.isFinite(input.amount) && input.amount >= 0)) return { ok: false, error: "The amount cannot be negative." };
  const filedOn = input.status === "filed" ? input.filedOn : null;
  const status: ComplianceFilingStatus = input.status === "filed" && filedOn && filedOn > input.dueOn ? "late" : input.status;
  const row = {
    item_id: input.itemId,
    period_key: input.periodKey,
    due_on: input.dueOn,
    status: status === "late" ? "filed" : status,
    filed_on: filedOn,
    reference_no: input.referenceNo.trim() || null,
    amount: input.amount,
    attachment_url: input.attachmentUrl.trim() || null,
    notes: input.notes.trim() || null,
    filed_by: input.status === "filed" ? caller.userId : null,
  };
  const { error } = await caller.supabase.schema("hr").from("compliance_filings").upsert(row, { onConflict: "item_id,period_key" });
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}

export async function deleteComplianceFiling(id: string): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase.schema("hr").from("compliance_filings").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}

export interface ComplianceItemInput {
  code: string;
  agency: string;
  name: string;
  form: string;
  category: ComplianceCategory;
  frequency: ComplianceFrequency;
  dueRule: unknown;
  applies: ComplianceApplies;
  active: boolean;
  portalUrl: string;
  notes: string;
}

/** Edits or adds an obligation. The due rule is validated by the same parser the calendar uses. */
export async function saveComplianceItem(id: string | null, input: ComplianceItemInput): Promise<ActionResult<{ id: string }>> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  if (!input.name.trim() || !input.agency.trim()) return { ok: false, error: "Agency and name are required." };
  const code = input.code.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  if (!code) return { ok: false, error: "Give the item a code." };
  let dueRule;
  try {
    dueRule = parseDueRule(input.dueRule);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Bad due rule." };
  }
  const row = {
    code,
    agency: input.agency.trim(),
    name: input.name.trim(),
    form: input.form.trim() || null,
    category: input.category,
    frequency: input.frequency,
    due_rule: dueRule,
    applies: input.applies,
    active: input.active,
    portal_url: input.portalUrl.trim() || null,
    notes: input.notes.trim() || null,
  };
  if (id) {
    const { error } = await caller.supabase.schema("hr").from("compliance_items").update(row).eq("id", id);
    if (error) return { ok: false, error: error.message };
    done();
    return { ok: true, data: { id } };
  }
  const { data, error } = await caller.supabase.schema("hr").from("compliance_items").insert({ ...row, sort_order: 900 }).select("id").single();
  if (error || !data) return { ok: false, error: error?.message ?? "Could not save." };
  done();
  return { ok: true, data: { id: data.id } };
}

export async function setComplianceItemActive(id: string, active: boolean): Promise<ActionResult> {
  const caller = await hrCaller();
  if (caller.error !== undefined) return { ok: false, error: caller.error };
  const { error } = await caller.supabase.schema("hr").from("compliance_items").update({ active }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  done();
  return { ok: true };
}
