"use client";

import { createClient } from "@/lib/supabase/client";
import { createCollection, createCollectionFamily, useCollection } from "@/lib/data/collection-store";
import type { StoredFile } from "@/lib/types/files";
import { folderFor } from "@/lib/utils/file-paths";

interface FileRow {
  id: string;
  module: StoredFile["module"];
  record_type: StoredFile["recordType"];
  record_id: string | null;
  sub_key: string | null;
  object_key: string;
  folder: string;
  file_name: string;
  content_type: string;
  size_bytes: number | string;
  status: StoredFile["status"];
  uploaded_by: string;
  created_at: string;
}

export function toStoredFile(r: FileRow): StoredFile {
  return {
    id: r.id,
    module: r.module,
    recordType: r.record_type,
    recordId: r.record_id,
    subKey: r.sub_key,
    objectKey: r.object_key,
    folder: r.folder,
    fileName: r.file_name,
    contentType: r.content_type,
    sizeBytes: Number(r.size_bytes),
    status: r.status,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  };
}

export const filesKey = (module: string, recordType: string, recordId: string) => `${module}|${recordType}|${recordId}`;

/** The files hanging on one record (an employee, an obligation, a patient…). RLS decides what comes back. */
export const filesFamily = createCollectionFamily<StoredFile[]>({
  key: "shared.files",
  empty: [],
  tables: () => [{ schema: "shared", table: "files" }],
  fetch: async (key: string) => {
    const [module, recordType, recordId] = key.split("|");
    let q = createClient().schema("shared").from("files").select("*").eq("module", module).eq("record_type", recordType);
    // General files hang on no record: the "record id" is the category, which names the folder.
    q = recordType === "general" ? q.is("record_id", null).eq("folder", folderFor({ kind: "general", category: recordId })) : q.eq("record_id", recordId);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as FileRow[]).map(toStoredFile);
  },
});

export function useRecordFiles(module: string, recordType: string, recordId: string) {
  const { data: files, loading, error } = useCollection(filesFamily.get(filesKey(module, recordType, recordId)));
  return { files, loading, error };
}

/** Every ready file the viewer may see, for the folder browser under Reports. */
export const allFilesStore = createCollection<StoredFile[]>({
  key: "shared.files.all",
  empty: [],
  tables: [{ schema: "shared", table: "files" }],
  fetch: async () => {
    const { data, error } = await createClient().schema("shared").from("files").select("*").eq("status", "ready").order("folder").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as FileRow[]).map(toStoredFile);
  },
});

export function useAllFiles() {
  const { data: files, loading, error } = useCollection(allFilesStore);
  return { files, loading, error };
}
