"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, useCollection } from "@/lib/data/collection-store";
import type { DocumentCategory, DocumentType } from "@/lib/types/hr";

interface DocumentTypeRow {
  id: string;
  name: string;
  category: DocumentCategory;
  required: boolean;
  validity_months: number | null;
  notes: string | null;
  sort: number;
  active: boolean;
}

/** The 201 checklist (hr.document_types, 0036): the masterlist's 17 items
 * plus PRC ID, editable by HR from /hr/settings. */
export const documentTypesStore = createCollection<DocumentType[]>({
  key: "hr.document_types",
  empty: [],
  tables: [{ schema: "hr", table: "document_types" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("hr").from("document_types").select("*").order("sort");
    if (error) throw new Error(error.message);
    return ((data ?? []) as DocumentTypeRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      required: row.required,
      validityMonths: row.validity_months,
      notes: row.notes,
      sort: row.sort,
      active: row.active,
    }));
  },
});

export function useDocumentTypes() {
  const { data: documentTypes, loading, error } = useCollection(documentTypesStore);
  return { documentTypes, loading, error };
}
