"use server";

import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { deleteObject, headObject, presignGet, presignPut } from "@/lib/files/b2";
import { contentTypeFor, folderFor, MAX_FILE_BYTES, MODULE_OF_RECORD, objectKeyFor, opensInline, sanitiseSegment, type FileRecordType, type FolderContext } from "@/lib/utils/file-paths";
import type { ActionResult } from "@/app/(app)/hr/actions";

/**
 * The file library's server side. Every database step runs AS THE CALLER,
 * so shared.files' policies (0045) decide who may add, see or remove a
 * file; the Backblaze key is used only to sign URLs and to remove objects
 * whose rows the caller was allowed to delete. Uploads never pass through
 * here: the browser PUTs straight to the bucket with the URL from
 * createUploadIntent and the server checks the object with a HEAD.
 */

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." as string, supabase: undefined, userId: undefined };
  const { data: staff } = await supabase.schema("shared").from("staff").select("active").eq("id", user.id).maybeSingle();
  if (!staff?.active) return { error: "This staff account is inactive." as string, supabase: undefined, userId: undefined };
  return { error: undefined, supabase, userId: user.id };
}

type Supabase = NonNullable<Awaited<ReturnType<typeof caller>>["supabase"]>;

export interface UploadIntentInput {
  recordType: FileRecordType;
  /** The record the file hangs on; a category name for general files. */
  recordId: string;
  /** document_type_id for 201 files, the period key for compliance files, free text otherwise. */
  subKey?: string | null;
  fileName: string;
  sizeBytes: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the parent record as the caller and names its folder; a record the caller cannot see is "not found". */
async function folderContext(supabase: Supabase, recordType: FileRecordType, recordId: string, subKey: string | null): Promise<{ ok: true; ctx: FolderContext } | { ok: false; error: string }> {
  if (recordType !== "general" && !UUID_RE.test(recordId)) return { ok: false, error: "Bad record id." };
  switch (recordType) {
    case "employee": {
      const { data } = await supabase.schema("hr").from("employees").select("employee_code, first_name, last_name").eq("id", recordId).maybeSingle();
      return data ? { ok: true, ctx: { kind: "employee", employeeCode: data.employee_code, firstName: data.first_name, lastName: data.last_name } } : { ok: false, error: "No such employee." };
    }
    case "compliance_item": {
      if (!subKey || !/^\d{4}(-\d{2}|-Q[1-4])?$/.test(subKey)) return { ok: false, error: "A compliance file needs its period (2026-08, 2026-Q3 or 2026)." };
      const { data } = await supabase.schema("hr").from("compliance_items").select("agency").eq("id", recordId).maybeSingle();
      return data ? { ok: true, ctx: { kind: "compliance_item", agency: data.agency, periodKey: subKey } } : { ok: false, error: "No such obligation." };
    }
    case "patient": {
      const { data } = await supabase.schema("ops").from("patients").select("patient_number, first_name, last_name").eq("id", recordId).maybeSingle();
      return data ? { ok: true, ctx: { kind: "patient", patientNumber: data.patient_number, firstName: data.first_name, lastName: data.last_name } } : { ok: false, error: "No such patient." };
    }
    case "donor": {
      const { data } = await supabase.schema("ops").from("donors").select("name").eq("id", recordId).maybeSingle();
      return data ? { ok: true, ctx: { kind: "donor", name: data.name } } : { ok: false, error: "No such donor." };
    }
    case "bank_statement_import": {
      const { data } = await supabase.schema("ops").from("bank_statement_imports").select("covers_to, created_at").eq("id", recordId).maybeSingle();
      return data ? { ok: true, ctx: { kind: "bank_statement_import", coversTo: data.covers_to, createdAt: data.created_at } } : { ok: false, error: "No such bank import." };
    }
    case "general":
      return { ok: true, ctx: { kind: "general", category: sanitiseSegment(recordId || "General") } };
  }
}

/**
 * Step 1 of an upload: the row (pending) and a five-minute URL to PUT the
 * bytes to. The insert runs as the caller, so the policy refuses anyone
 * the module does not admit before any URL is signed.
 */
export async function createUploadIntent(input: UploadIntentInput): Promise<ActionResult<{ id: string; url: string; contentType: string; folder: string }>> {
  const c = await caller();
  if (c.error !== undefined) return { ok: false, error: c.error };
  const fileName = input.fileName.trim();
  if (!fileName) return { ok: false, error: "The file has no name." };
  const contentType = contentTypeFor(fileName);
  if (!contentType) return { ok: false, error: "That file type is not accepted: PDF, images, Word, Excel, CSV or text." };
  if (!(input.sizeBytes > 0)) return { ok: false, error: "The file is empty." };
  if (input.sizeBytes > MAX_FILE_BYTES) return { ok: false, error: "Files are limited to 50 MB." };
  const fileModule = MODULE_OF_RECORD[input.recordType];
  if (!fileModule) return { ok: false, error: "Unknown record type." };
  const subKey = input.subKey?.trim() || null;
  const f = await folderContext(c.supabase, input.recordType, input.recordId, subKey);
  if (!f.ok) return f;
  const folder = folderFor(f.ctx);
  const id = randomUUID();
  const objectKey = objectKeyFor(folder, id, fileName);
  const { error } = await c.supabase.schema("shared").from("files").insert({
    id,
    module: fileModule,
    record_type: input.recordType,
    record_id: input.recordType === "general" ? null : input.recordId,
    sub_key: subKey,
    object_key: objectKey,
    folder,
    file_name: sanitiseSegment(fileName),
    content_type: contentType,
    size_bytes: input.sizeBytes,
    status: "pending",
    uploaded_by: c.userId,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "You cannot add files here." : error.message };
  try {
    const url = await presignPut(objectKey, contentType);
    return { ok: true, data: { id, url, contentType, folder } };
  } catch (e) {
    await c.supabase.schema("shared").from("files").delete().eq("id", id);
    return { ok: false, error: e instanceof Error ? e.message : "Could not sign the upload." };
  }
}

/** Step 2: the object is in the bucket; check it and mark the row ready. Size comes from the bucket, never from the browser. */
export async function confirmUpload(id: string): Promise<ActionResult<{ sizeBytes: number }>> {
  const c = await caller();
  if (c.error !== undefined) return { ok: false, error: c.error };
  const { data: row } = await c.supabase.schema("shared").from("files").select("object_key, content_type, status, uploaded_by").eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "No such upload." };
  if (row.uploaded_by !== c.userId) return { ok: false, error: "Only the uploader can confirm this file." };
  if (row.status === "ready") return { ok: true, data: { sizeBytes: 0 } };
  const head = await headObject(row.object_key);
  if (!head) return { ok: false, error: "The file did not reach the bucket. Try again." };
  if (head.size > MAX_FILE_BYTES || head.size <= 0) {
    await deleteObject(row.object_key).catch(() => undefined);
    await c.supabase.schema("shared").from("files").delete().eq("id", id);
    return { ok: false, error: "The uploaded file is empty or over 50 MB; it was removed." };
  }
  const { error } = await c.supabase.schema("shared").from("files").update({ status: "ready", size_bytes: head.size }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: { sizeBytes: head.size } };
}

/** The browser could not finish the PUT: drop the pending row (and any partial object). */
export async function abandonUpload(id: string): Promise<ActionResult> {
  const c = await caller();
  if (c.error !== undefined) return { ok: false, error: c.error };
  const { data: row } = await c.supabase.schema("shared").from("files").select("object_key, status, uploaded_by").eq("id", id).maybeSingle();
  if (!row || row.uploaded_by !== c.userId || row.status !== "pending") return { ok: true };
  await c.supabase.schema("shared").from("files").delete().eq("id", id);
  await deleteObject(row.object_key).catch(() => undefined);
  return { ok: true };
}

/** A five-minute link to open one file. The select runs as the caller: no row, no link. */
export async function fileOpenUrl(id: string): Promise<ActionResult<{ url: string }>> {
  const c = await caller();
  if (c.error !== undefined) return { ok: false, error: c.error };
  const { data: row } = await c.supabase.schema("shared").from("files").select("object_key, file_name, content_type, status").eq("id", id).maybeSingle();
  if (!row || row.status !== "ready") return { ok: false, error: "That file is not available to you." };
  try {
    const url = await presignGet(row.object_key, row.file_name, row.content_type, opensInline(row.content_type));
    return { ok: true, data: { url } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not sign the link." };
  }
}

/** Removes a file: the row first, as the caller (0 rows = refused, the bucket untouched), then the object. */
export async function deleteFile(id: string): Promise<ActionResult> {
  const c = await caller();
  if (c.error !== undefined) return { ok: false, error: c.error };
  const { data: deleted, error } = await c.supabase.schema("shared").from("files").delete().eq("id", id).select("object_key");
  if (error) return { ok: false, error: error.message };
  if (!deleted || deleted.length === 0) return { ok: false, error: "You cannot remove this file." };
  try {
    await deleteObject(deleted[0].object_key);
  } catch (e) {
    // The row is gone, so nobody can reach the object; it is a private orphan for the bucket's lifecycle rules.
    console.error("[files] object delete failed", deleted[0].object_key, e instanceof Error ? e.message : e);
  }
  return { ok: true };
}
