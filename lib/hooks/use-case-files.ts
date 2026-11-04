"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { createCollection, createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import { cleanData, type DocumentKind, type FormData, type FormId } from "@/lib/case-files/forms";

/**
 * Case files (0124): a child's case records and folder papers. The social worker reads and writes;
 * the Super Admin and the CEO read only; the database refuses everyone else. Callers pass `enabled`
 * from the role (see canReadCaseFiles), so nobody else's browser even asks.
 */
export type CaseStatus = "scheduled" | "draft" | "approved";

/** Who sees case files (0124): the social worker, the Super Admin and the CEO. Only the social worker writes. */
export const canReadCaseFiles = (roles: readonly string[]) => roles.some((r) => r === "social_worker" || r === "admin" || r === "ceo");
export const canWriteCaseFiles = (roles: readonly string[]) => roles.includes("social_worker");

export interface CaseRecord {
  id: string;
  patientId: string;
  form: FormId;
  status: CaseStatus;
  scheduledAt: string | null;
  venue: string | null;
  heldOn: string | null;
  data: FormData;
  sourceDocumentId: string | null;
  preparedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  ceoSignedOn: string | null;
  reopenedTimes: number;
  updatedAt: string;
}

export interface CaseDocument {
  id: string;
  patientId: string;
  kind: DocumentKind;
  storagePath: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
  aiStatus: "off" | "pending" | "read" | "failed";
  aiSummary: string | null;
  aiError: string | null;
}

type Result = { ok: true } | { ok: false; error: string };
const db = () => createClient().schema("ops");

const toRecord = (r: Record<string, unknown>): CaseRecord => ({
  id: r.id as string,
  patientId: r.patient_id as string,
  form: r.form as FormId,
  status: r.status as CaseStatus,
  scheduledAt: (r.scheduled_at as string) ?? null,
  venue: (r.venue as string) ?? null,
  heldOn: (r.held_on as string) ?? null,
  data: (r.data as FormData) ?? {},
  sourceDocumentId: (r.source_document_id as string) ?? null,
  preparedBy: (r.prepared_by as string) ?? null,
  approvedBy: (r.approved_by as string) ?? null,
  approvedAt: (r.approved_at as string) ?? null,
  ceoSignedOn: (r.ceo_signed_on as string) ?? null,
  reopenedTimes: Array.isArray(r.history) ? r.history.length : 0,
  updatedAt: r.updated_at as string,
});

const toDocument = (r: Record<string, unknown>): CaseDocument => ({
  id: r.id as string,
  patientId: r.patient_id as string,
  kind: r.kind as DocumentKind,
  storagePath: r.storage_path as string,
  fileName: r.file_name as string,
  contentType: r.content_type as string,
  sizeBytes: r.size_bytes as number,
  uploadedAt: r.uploaded_at as string,
  aiStatus: r.ai_status as CaseDocument["aiStatus"],
  aiSummary: (r.ai_summary as string) ?? null,
  aiError: (r.ai_error as string) ?? null,
});

const records = createCollectionFamily<CaseRecord[]>({
  key: "ops.case_records",
  empty: [],
  tables: () => [{ schema: "ops", table: "case_records" }],
  fetch: async (patientId) => {
    const { data, error } = await db().from("case_records").select("*").eq("patient_id", patientId).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toRecord);
  },
});

const documents = createCollectionFamily<CaseDocument[]>({
  key: "ops.case_documents",
  empty: [],
  tables: () => [{ schema: "ops", table: "case_documents" }],
  fetch: async (patientId) => {
    const { data, error } = await db().from("case_documents").select("*").eq("patient_id", patientId).order("uploaded_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toDocument);
  },
});

/** Every session booked, record not yet approved, or approved record still waiting for the CEO's
 * signature, across children: the Case sessions page and the bell. */
export const openCaseRecordsStore = createCollection<CaseRecord[]>({
  key: "ops.case_records.open",
  empty: [],
  tables: [{ schema: "ops", table: "case_records" }],
  fetch: async () => {
    const { data, error } = await db().from("case_records").select("*").or("status.neq.approved,ceo_signed_on.is.null").order("scheduled_at", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(toRecord);
  },
});

export function useOpenCaseRecords(enabled: boolean) {
  const { data, loading } = useCollection(enabled ? openCaseRecordsStore : null);
  return { open: enabled ? data : [], loading: enabled && loading };
}

export interface SaveInput {
  id?: string;
  form: FormId;
  status: "scheduled" | "draft";
  scheduledAt?: string | null;
  venue?: string | null;
  heldOn?: string | null;
  data: FormData;
  sourceDocumentId?: string | null;
}

const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function useCaseFile(patientId: string, enabled: boolean) {
  const recordStore = enabled ? records.get(patientId) : null;
  const documentStore = enabled ? documents.get(patientId) : null;
  const { data: caseRecords, loading: loadingRecords } = useCollection(recordStore);
  const { data: caseDocuments, loading: loadingDocuments } = useCollection(documentStore);
  const refresh = async () => {
    await Promise.all([recordStore?.refetch(), documentStore?.refetch(), openCaseRecordsStore.refetch()]);
  };
  const done = async (error: { message: string } | null): Promise<Result> => {
    if (error) return { ok: false, error: error.message };
    await refresh();
    return { ok: true };
  };

  async function save(input: SaveInput): Promise<Result & { id?: string }> {
    const row = {
      form: input.form,
      status: input.status,
      scheduled_at: input.scheduledAt ?? null,
      venue: input.venue?.trim() || null,
      held_on: input.heldOn || null,
      data: cleanData(input.form, input.data),
      source_document_id: input.sourceDocumentId ?? null,
    };
    const res = input.id
      ? await db().from("case_records").update(row).eq("id", input.id).select("id").single()
      : await db().from("case_records").insert({ ...row, patient_id: patientId }).select("id").single();
    const r = await done(res.error);
    return r.ok ? { ok: true, id: (res.data as { id: string }).id } : r;
  }

  const setStatus = async (id: string, patch: Record<string, unknown>) => done((await db().from("case_records").update(patch).eq("id", id)).error);

  async function upload(kind: DocumentKind, file: File): Promise<Result & { id?: string }> {
    if (!TYPES.includes(file.type)) return { ok: false, error: "Upload a PDF or a photo (JPG, PNG or WebP)." };
    if (file.size > MAX_BYTES) return { ok: false, error: "That file is over 15 MB: scan it at a lower resolution." };
    const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "document";
    const path = `${patientId}/${crypto.randomUUID()}-${safe}`;
    const storage = createClient().storage.from("case-files");
    const up = await storage.upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) return { ok: false, error: up.error.message };
    const { data, error } = await db()
      .from("case_documents")
      .insert({ patient_id: patientId, kind, storage_path: path, file_name: file.name.slice(0, 200), content_type: file.type, size_bytes: file.size })
      .select("id")
      .single();
    if (error) {
      await storage.remove([path]);
      return { ok: false, error: error.message };
    }
    await refresh();
    return { ok: true, id: (data as { id: string }).id };
  }

  async function openDocument(doc: CaseDocument): Promise<string | null> {
    const { data } = await createClient().storage.from("case-files").createSignedUrl(doc.storagePath, 120);
    return data?.signedUrl ?? null;
  }

  async function removeDocument(doc: CaseDocument): Promise<Result> {
    const { error } = await db().from("case_documents").delete().eq("id", doc.id);
    if (error) return { ok: false, error: error.message };
    await createClient().storage.from("case-files").remove([doc.storagePath]);
    await refresh();
    return { ok: true };
  }

  /** Asks the server to read a paper with the AI (only when Settings allows it). */
  async function readDocument(documentId: string): Promise<Result & { drafted?: number }> {
    const res = await fetch("/api/case-files/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; drafted?: number };
    await refresh();
    return res.ok ? { ok: true, drafted: body.drafted ?? 0 } : { ok: false, error: body.error ?? "The document couldn't be read." };
  }

  return {
    records: caseRecords,
    documents: caseDocuments,
    loading: enabled && (loadingRecords || loadingDocuments),
    save,
    approve: (id: string) => setStatus(id, { status: "approved" }),
    reopen: (id: string) => setStatus(id, { status: "draft" }),
    recordCeoSigned: (id: string, on: string | null) => setStatus(id, { ceo_signed_on: on }),
    remove: async (id: string) => done((await db().from("case_records").delete().eq("id", id)).error),
    upload,
    openDocument,
    removeDocument,
    readDocument,
  };
}

/** The intervention plan is updated twice a year (DSWD checklist item 6): how many children's latest
 * approved plan is more than six months old, for the social worker's bell (0126). */
export function usePlansDue(enabled: boolean): number {
  const [due, setDue] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return;
    void db()
      .from("case_records")
      .select("patient_id, held_on")
      .eq("form", "intervention_plan")
      .eq("status", "approved")
      .then(({ data }) => {
        const latest = new Map<string, string>();
        for (const r of (data ?? []) as { patient_id: string; held_on: string }[]) if (!latest.has(r.patient_id) || r.held_on > latest.get(r.patient_id)!) latest.set(r.patient_id, r.held_on);
        const cutoff = new Date(Date.now() - 182 * 86_400_000).toISOString().slice(0, 10);
        setDue([...latest.values()].filter((d) => d < cutoff).length);
      });
  }, [enabled]);
  return due;
}
