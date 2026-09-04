"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import type { PatientDocument, PatientDocumentType } from "@/lib/types/patient";

export type MutationResult = { ok: true } | { ok: false; error: string };

export const DOCUMENT_TYPE_LABELS: Record<PatientDocumentType, string> = {
  parent_guardian_id: "Parent/Guardian ID",
  medical_certificate: "Medical Certificate",
  signed_intake_form: "Signed Intake Form",
  patient_photo: "Patient's Photo",
  photo_media_consent: "Photo/Media Consent",
};

export const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as PatientDocumentType[];

interface PatientDocumentRow {
  id: string;
  patient_id: string;
  document_type: PatientDocumentType;
  storage_path: string | null;
  collected_at: string | null;
  collected_by_staff_id: string | null;
  notes: string | null;
}

function toPatientDocument(row: PatientDocumentRow): PatientDocument {
  return {
    id: row.id,
    patientId: row.patient_id,
    documentType: row.document_type,
    storagePath: row.storage_path ?? undefined,
    collectedAt: row.collected_at ?? undefined,
    collectedByStaffId: row.collected_by_staff_id ?? undefined,
    notes: row.notes ?? undefined,
  };
}

/** Per-patient admission document checklist against `ops.patient_documents` + the
 * `patient-documents` Storage bucket. Non-blocking -- never gates admission. */
const patientDocuments = createCollectionFamily<PatientDocument[]>({
  key: "ops.patient_documents",
  empty: [],
  tables: () => [{ schema: "ops", table: "patient_documents" }],
  fetch: async (patientId) => {
    const { data, error } = await createClient().schema("ops").from("patient_documents").select("*").eq("patient_id", patientId);
    if (error) throw new Error(error.message);
    return ((data ?? []) as PatientDocumentRow[]).map(toPatientDocument);
  },
});

export function usePatientDocuments(patientId: string) {
  const store = patientDocuments.get(patientId);
  const { data: documents, loading } = useCollection(store);

  async function markCollected(documentType: PatientDocumentType, notes?: string): Promise<MutationResult> {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .schema("ops")
      .from("patient_documents")
      .upsert(
        {
          patient_id: patientId,
          document_type: documentType,
          collected_at: new Date().toISOString(),
          collected_by_staff_id: userData.user?.id ?? null,
          notes: notes ?? null,
        },
        { onConflict: "patient_id,document_type" }
      );
    if (error) return { ok: false, error: error.message };
    await store.refetch();
    return { ok: true };
  }

  async function uploadFile(documentType: PatientDocumentType, file: File): Promise<MutationResult> {
    const supabase = createClient();
    const path = `${patientId}/${documentType}-${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("patient-documents").upload(path, file, { upsert: true });
    if (uploadError) return { ok: false, error: uploadError.message };

    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .schema("ops")
      .from("patient_documents")
      .upsert(
        {
          patient_id: patientId,
          document_type: documentType,
          storage_path: path,
          collected_at: new Date().toISOString(),
          collected_by_staff_id: userData.user?.id ?? null,
        },
        { onConflict: "patient_id,document_type" }
      );
    if (error) return { ok: false, error: error.message };
    await store.refetch();
    return { ok: true };
  }

  async function getSignedUrl(storagePath: string): Promise<string | null> {
    const supabase = createClient();
    const { data } = await supabase.storage.from("patient-documents").createSignedUrl(storagePath, 60 * 5);
    return data?.signedUrl ?? null;
  }

  return { documents, loading, markCollected, uploadFile, getSignedUrl, refetch: store.refetch };
}
