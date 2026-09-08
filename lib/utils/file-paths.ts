/**
 * Where a file lives in the bucket: the folder mirrors the app's main menu
 * so the bucket reads like the app when opened in the Backblaze console.
 *
 *   HR/201 Files/Dela Cruz, Juan (EMP-3005)/<file>
 *   Compliances/BIR/2026/08 August/<file>          (monthly obligation)
 *   Compliances/SEC/2026/Annual/<file>             (annual)
 *   Compliances/BIR/2026/Q3/<file>                 (quarterly)
 *   Patients/Santos, Ana (PT-0012)/<file>
 *   Donors/Manny Chan/<file>
 *   Financial/Bank Statements/2026/08 August/<file>
 *   Reports/<category>/<file>
 *
 * The object key is the folder plus the first eight characters of the
 * file row's id and the sanitised file name, so two uploads of the same
 * name never collide and a file can be traced back to its row. The folder
 * is a snapshot taken at upload time; renaming a record does not move
 * its files.
 *
 * B2 keys are UTF-8, at most 1,024 bytes, no control characters. Pure, so
 * it runs under `node --test`.
 */

export type FileModule = "hr" | "compliance" | "patients" | "donors" | "finance" | "reports";
export type FileRecordType = "employee" | "compliance_item" | "patient" | "donor" | "bank_statement_import" | "general";

export const MODULE_OF_RECORD: Readonly<Record<FileRecordType, FileModule>> = {
  employee: "hr",
  compliance_item: "compliance",
  patient: "patients",
  donor: "donors",
  bank_statement_import: "finance",
  general: "reports",
};

export type FolderContext =
  | { kind: "employee"; employeeCode: string; firstName: string; lastName: string }
  | { kind: "compliance_item"; agency: string; periodKey: string }
  | { kind: "patient"; patientNumber: string; firstName: string; lastName: string }
  | { kind: "donor"; name: string }
  | { kind: "bank_statement_import"; coversTo: string | null; createdAt: string }
  | { kind: "general"; category: string };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MAX_SEGMENT = 80;
const MAX_KEY_BYTES = 900;

/** One folder or file-name segment: safe for B2, readable in the console, never a path of its own. */
export function sanitiseSegment(raw: string): string {
  const s = raw
    .normalize("NFC")
    .replace(/[/\\]/g, "-")
    .replace(/[\x00-\x1f\x7f:*?"<>|{}^%`\]\[~#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  const cut = s.length > MAX_SEGMENT ? s.slice(0, MAX_SEGMENT).trim() : s;
  return cut || "untitled";
}

/** "2026-08" -> "2026/08 August"; "2026-Q3" -> "2026/Q3"; "2026" -> "2026/Annual". */
export function periodFolder(periodKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (m) {
    const month = Number(m[2]);
    return month >= 1 && month <= 12 ? `${m[1]}/${m[2]} ${MONTHS[month - 1]}` : `${m[1]}/${sanitiseSegment(m[2])}`;
  }
  const q = /^(\d{4})-(Q[1-4])$/.exec(periodKey);
  if (q) return `${q[1]}/${q[2]}`;
  if (/^\d{4}$/.test(periodKey)) return `${periodKey}/Annual`;
  return sanitiseSegment(periodKey);
}

/** "Last, First (CODE)" as a single segment. */
export function personFolder(lastName: string, firstName: string, code: string): string {
  return sanitiseSegment(`${lastName.trim()}, ${firstName.trim()} (${code.trim()})`);
}

export function folderFor(ctx: FolderContext): string {
  switch (ctx.kind) {
    case "employee":
      return `HR/201 Files/${personFolder(ctx.lastName, ctx.firstName, ctx.employeeCode)}`;
    case "compliance_item":
      return `Compliances/${sanitiseSegment(ctx.agency)}/${periodFolder(ctx.periodKey)}`;
    case "patient":
      return `Patients/${personFolder(ctx.lastName, ctx.firstName, ctx.patientNumber)}`;
    case "donor":
      return `Donors/${sanitiseSegment(ctx.name)}`;
    case "bank_statement_import": {
      const day = (ctx.coversTo ?? ctx.createdAt).slice(0, 7);
      return `Financial/Bank Statements/${periodFolder(day)}`;
    }
    case "general":
      return `Reports/${sanitiseSegment(ctx.category)}`;
  }
}

/** The bucket key for one file: folder, the row id's first eight characters, and the sanitised file name. */
export function objectKeyFor(folder: string, fileId: string, fileName: string): string {
  const stem = sanitiseSegment(fileName);
  const prefix = `${folder}/${fileId.slice(0, 8)}-`;
  const room = MAX_KEY_BYTES - Buffer.byteLength(prefix, "utf8");
  let name = stem;
  while (Buffer.byteLength(name, "utf8") > room && name.length > 1) name = name.slice(0, -1);
  return `${prefix}${name}`;
}

/** The types the library accepts, by extension, with the content type the app declares to the bucket. */
export const ACCEPTED_FILE_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** The content type for a file name, or null when the type is not accepted. Browsers report "" for unknown types, so the extension decides. */
export function contentTypeFor(fileName: string): string | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return ext && ext !== fileName.toLowerCase() ? (ACCEPTED_FILE_TYPES[ext] ?? null) : null;
}

/** PDFs and images open in the browser tab; everything else downloads. */
export function opensInline(contentType: string): boolean {
  return contentType === "application/pdf" || contentType.startsWith("image/");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
