import type { FileModule, FileRecordType } from "@/lib/utils/file-paths";

export type { FileModule, FileRecordType };

/** One uploaded file (shared.files, 0045). */
export interface StoredFile {
  id: string;
  module: FileModule;
  recordType: FileRecordType;
  recordId: string | null;
  subKey: string | null;
  objectKey: string;
  /** The folder as the bucket console shows it: "HR/201 Files/Dela Cruz, Juan (EMP-3005)". */
  folder: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: "pending" | "ready";
  uploadedBy: string;
  createdAt: string;
}

export const FILE_MODULE_LABELS: Readonly<Record<FileModule, string>> = {
  hr: "HR",
  compliance: "Compliances",
  patients: "Patients",
  donors: "Donors",
  finance: "Financial",
  reports: "Reports",
};
