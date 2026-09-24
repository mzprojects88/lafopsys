/**
 * LAF's Patients Database sheet -- the patient master while staff learn the
 * app (0057, Master Plan steps 1-2). The app only READS it. Since
 * 2026-09-24 the app is the record: the sync turns an edit on the sheet into
 * a proposal a person applies (0064), never an overwrite.
 *
 * Pure, relative imports only: tests/master-sheet.test.mjs runs it under
 * node --test. The name rules are the original importer's
 * (scripts/clean-real-data.py), so a sync never disagrees with the import.
 */
import { parseCsv } from "./bank-statement.ts";
import { normalizeName, splitName } from "./house-sheet.ts";

export const MASTER_SHEET_ID = "16IllEPWoz0oEF0polLIH3BrPQNkNYdcg04RHpyh072s";
/** Pinned: this workbook's tabs do not move (unlike the house sheet's daily tabs). */
export const MASTER_TABS = { patients: "161600482", extract: "261557177", intake: "2109115764" } as const;

export function masterCsvUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/export?format=csv&gid=${gid}`;
}

export const ILLNESS_CODES = {
  C: "Cancer (Hema-Onco)",
  T: "Thalassemia",
  B: "Other Blood Disorders",
  H: "Heart / Cardiovascular",
  O: "Other Critical Illnesses",
  FD: "For determining",
} as const;
export type IllnessCode = keyof typeof ILLNESS_CODES;
/** ops.patients.illness_type, the older broad label the DSWD figures were imported with; it follows the code. */
export const ILLNESS_TYPE_LABEL: Record<IllnessCode, string> = { C: "Cancer", T: "Thalassemia", B: "Others", H: "Cardio", O: "Others", FD: "For determining" };

export const PRIORITIES = { A: "Chemo", B: "Blood transfusion", C: "Post procedure", D: "Follow-up consultation" } as const;
export type Priority = keyof typeof PRIORITIES;

export type SheetStatus = "ongoing" | "check_up" | "expired" | "non_pedia";
const STATUS_MAP: Record<string, SheetStatus> = {
  "on-going treatment": "ongoing",
  "ongoing treatment": "ongoing",
  expired: "expired",
  "non-pedia": "non_pedia",
  "check up": "check_up",
};

// ---------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------

const clean = (v: string | undefined): string | null => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};

/** "6/27/2026" or "06/27/26" -> "2026-06-27"; anything else -> null. */
export function sheetDate(raw: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec((raw ?? "").trim());
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const month = Number(m[1]);
  const day = Number(m[2]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Sheet phones lose their leading 0 ("9755997520"); several are separated by "/" or a line break. */
export function normalizePhone(raw: string | undefined): string | null {
  const parts = (raw ?? "")
    .split(/[/\n,]+/)
    .map((p) => p.replace(/\D/g, ""))
    .filter((p) => p.length >= 7)
    .map((p) => (p.length === 10 && p.startsWith("9") ? `0${p}` : p));
  return parts.length ? parts.join(" / ") : null;
}

/** The sheet's CODE "LAF-2024-001-C" -> "LFCN-2024-0001" (the illness letter is not part of the number). */
export function caseNumberFromCode(code: string | null | undefined): string | null {
  const m = /^LAF-(\d{4})-(\d{1,4})\b/i.exec((code ?? "").trim());
  if (!m || Number(m[2]) === 0) return null;
  return `LFCN-${m[1]}-${m[2].padStart(4, "0")}`;
}

/** "RIV-A" -> "Region IV-A", "NCR" -> "NCR" (how ops.provinces.region is written). */
export function regionName(code: string | null | undefined): string | null {
  const s = (code ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "NCR" || s === "CAR" || s === "BARMM") return s;
  const m = /^R(?:EGION)?\s*([IVX]+)(-?[AB])?$/.exec(s);
  if (!m) return null;
  return `Region ${m[1]}${m[2] ? `-${m[2].replace("-", "")}` : ""}`;
}

/** The sheet's age bracket, from age today (its own AB column is typed by hand and goes stale). */
export function sheetAgeBracket(age: number): string {
  if (age < 5) return "0 to 5";
  if (age < 10) return "5 to 10";
  if (age < 15) return "10 to 15";
  if (age < 18) return "15 to 18";
  return "18+";
}

// ---------------------------------------------------------------------
// Reference names (the importer's rules)
// ---------------------------------------------------------------------

/** Abbreviations that mean a diagnosis already on the list (scripts/clean-real-data.py). */
export const DIAGNOSIS_SYNONYMS: Readonly<Record<string, string>> = {
  all: "acute lymphoblastic leukemia",
  aml: "acute myeloid leukemia",
  "bcell all": "acute lymphoblastic leukemia",
  "tcell all": "acute lymphoblastic leukemia",
  "b-cell all": "acute lymphoblastic leukemia",
  "t-cell all": "acute lymphoblastic leukemia",
  apl: "acute promyelocytic leukemia",
};

/** The key a diagnosis is looked up by: lowercase, synonyms resolved. */
export function diagnosisKey(name: string): string {
  const k = name.trim().toLowerCase().replace(/\s+/g, " ");
  return DIAGNOSIS_SYNONYMS[k] ?? k;
}

/** Province names the importer folded together (scripts/clean-real-data.py). */
export const PROVINCE_SYNONYMS: Readonly<Record<string, string>> = { "metro manila": "ncr" };

export function provinceKey(name: string): string {
  const k = name.trim().toLowerCase().replace(/\s+/g, " ");
  return PROVINCE_SYNONYMS[k] ?? k;
}

/** A treatment phase's lookup key; "Expired" is a status, never a phase. */
export function phaseKey(name: string | null): string | null {
  const k = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return k === "" || k === "expired" ? null : k;
}

const CANCER_WORDS = ["leukemia", "lymphoma", "tumor", "tumour", "sarcoma", "carcinoma", "blastoma", "malignan", "teratoma"];
/** ops.diagnoses.category for a new diagnosis: the illness code when the sheet gives one, else the name. */
export function diagnosisCategory(name: string, illnessCode: IllnessCode | null): "cancer" | "thalassemia" | "other" {
  if (illnessCode === "C") return "cancer";
  if (illnessCode === "T") return "thalassemia";
  if (illnessCode) return "other";
  const lower = name.toLowerCase();
  if (lower.includes("thalassemia")) return "thalassemia";
  if (CANCER_WORDS.some((w) => lower.includes(w)) || /\b(all|aml|cml|cll|apl)\b/.test(lower)) return "cancer";
  return "other";
}

/** A new reference row's id: prefix + slug, disambiguated against ids already taken. */
export function refId(prefix: string, name: string, taken: ReadonlySet<string>): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  let id = `${prefix}-${slug}`;
  for (let n = 2; taken.has(id); n += 1) id = `${prefix}-${slug}-${n}`;
  return id;
}

// ---------------------------------------------------------------------
// The Patients Database tab
// ---------------------------------------------------------------------

export interface MasterRow {
  cn: string;
  admittedOn: string | null;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  sex: "M" | "F" | null;
  address: string | null;
  province: string | null;
  regionCode: string | null;
  status: SheetStatus | null;
  illnessCode: IllnessCode | null;
  diagnosis: string | null;
  phase: string | null;
  carerName: string | null;
  carerRelationship: string | null;
  carerPhone: string | null;
  maritalStatus: string | null;
  priority: Priority | null;
  remarks: string | null;
  legacyCode: string | null;
  /** The row's cells as typed, by header (kept on the record so the copy can repeat the sheet's own words). */
  raw: Record<string, string>;
}

export interface MasterParseResult {
  rows: MasterRow[];
  problems: string[];
}

const REQUIRED = ["CN", "NAME"];

export function parseMasterCsv(csv: string): MasterParseResult {
  const grid = parseCsv(csv);
  const header = (grid[0] ?? []).map((h) => h.trim().toUpperCase());
  const missing = REQUIRED.filter((h) => !header.includes(h));
  if (missing.length) return { rows: [], problems: [`The Patients Database tab has no ${missing.join(", ")} column; first row: ${header.join(" | ")}`] };
  const col = (row: string[], name: string) => {
    const i = header.indexOf(name);
    return i < 0 ? undefined : row[i];
  };

  const rows: MasterRow[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const [n, row] of grid.slice(1).entries()) {
    const cn = clean(col(row, "CN"));
    const name = clean(col(row, "NAME"));
    if (!cn && !name) continue; // the sheet's empty pre-formatted rows
    if (!cn || !/^\d+$/.test(cn)) {
      problems.push(`Row ${n + 2}: no CN, skipped`);
      continue;
    }
    if (!name) {
      problems.push(`CN ${cn}: no name, skipped`);
      continue;
    }
    if (seen.has(cn)) {
      problems.push(`CN ${cn} appears twice; the first row is used`);
      continue;
    }
    seen.add(cn);
    const { first, last } = splitName(name);
    const sex = clean(col(row, "S"))?.toUpperCase();
    const illness = clean(col(row, "I"))?.toUpperCase();
    const priority = clean(col(row, "P"))?.toUpperCase();
    rows.push({
      cn,
      admittedOn: sheetDate(col(row, "DE")),
      firstName: first,
      lastName: last,
      birthDate: sheetDate(col(row, "BD")),
      sex: sex === "M" || sex === "F" ? sex : null,
      address: clean(col(row, "ADD")),
      province: clean(col(row, "P/C")),
      regionCode: clean(col(row, "R")),
      status: STATUS_MAP[(clean(col(row, "PS")) ?? "").toLowerCase()] ?? null,
      illnessCode: illness && illness in ILLNESS_CODES ? (illness as IllnessCode) : null,
      diagnosis: clean(col(row, "D")),
      phase: clean(col(row, "TP")),
      carerName: clean(col(row, "CARER")),
      carerRelationship: clean(col(row, "RX")),
      carerPhone: normalizePhone(col(row, "CP")),
      maritalStatus: clean(col(row, "MS"))?.toUpperCase() ?? null,
      priority: priority && priority in PRIORITIES ? (priority as Priority) : null,
      remarks: clean(col(row, "REMARKS")),
      legacyCode: clean(col(row, "CODE")),
      raw: Object.fromEntries(header.flatMap((h, i) => (h && (row[i] ?? "").trim() ? [[h, (row[i] ?? "").trim()]] : []))),
    });
  }
  return { rows, problems };
}

/**
 * What a child's record still lacks, whichever side filled the rest: the
 * sheet's value when it has one, else what the social worker encoded in
 * the app (user, 2026-09-23: the sheet may be incomplete; the social
 * worker completes the record in the app, and a blank sheet cell never
 * erases it).
 */
export function recordGaps(r: {
  birthDate: string | null;
  address: string | null;
  sex: string | null;
  carer: { name: string | null; relationship: string | null; phone: string | null } | null;
}): string[] {
  return [
    !r.birthDate && "birthday",
    !r.sex && "sex",
    !r.address && "address",
    !r.carer?.name && "carer",
    r.carer?.name && !r.carer.relationship && "carer's relationship",
    r.carer?.name && !r.carer.phone && "carer's phone",
  ].filter((x): x is string => !!x);
}

/** Extract tab: CN -> distance from home in km (its last column, e.g. "34 km"). */
export function parseDistanceCsv(csv: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of parseCsv(csv).slice(1)) {
    const cn = (row[0] ?? "").trim();
    if (!/^\d+$/.test(cn)) continue;
    const km = [...row].reverse().map((c) => /^([\d.,]+)\s*km\b/i.exec(c.trim())).find(Boolean);
    if (km) out.set(cn, Number(km[1].replace(/,/g, "")));
  }
  return out;
}

// ---------------------------------------------------------------------
// The intake form (NEW&OLD Form Responses AIS)
// ---------------------------------------------------------------------

export interface IntakeRow {
  submittedAt: string | null;
  authorized: boolean;
  name: string;
  birthDate: string | null;
  mssName: string | null;
  attendingPhysician: string | null;
  parentEducation: string | null;
  parentOccupation: string | null;
  householdIncome: string | null;
  parentEmployment: string | null;
  housingType: string | null;
  links: { photo?: string; parentId?: string; medicalCertificate?: string };
}

const INTAKE_FIELDS: Record<string, keyof IntakeRow | "photo" | "parentId" | "medicalCertificate"> = {
  timestamp: "submittedAt",
  authorization: "authorized",
  name: "name",
  birthday: "birthDate",
  "name of mss": "mssName",
  "attending physician": "attendingPhysician",
  "highest educational attainment": "parentEducation",
  occupation: "parentOccupation",
  "estimated monthly income": "householdIncome",
  "employment status": "parentEmployment",
  "type of housing": "housingType",
  "solo photo of the patient": "photo",
  "parent's id with address": "parentId",
  "carer's id with address": "parentId",
  "medical certificate": "medicalCertificate",
};

/** "9/5/2025 14:03:22" (Manila) -> ISO instant. */
function formTimestamp(raw: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/.exec((raw ?? "").trim());
  if (!m) return null;
  const pad = (s: string) => s.padStart(2, "0");
  return `${m[3]}-${pad(m[1])}-${pad(m[2])}T${pad(m[4])}:${m[5]}:${m[6]}+08:00`;
}

/**
 * The form's responses, oldest first. The tab stacks two versions of the form,
 * the second with its own header row part-way down, so a row that reads like a
 * header switches the column map for the rows below it.
 */
export function parseIntakeCsv(csv: string): IntakeRow[] {
  const grid = parseCsv(csv);
  const mapFor = (row: string[]) => row.map((c) => INTAKE_FIELDS[c.trim().toLowerCase()] ?? null);
  const looksLikeHeader = (row: string[]) => row.filter((c) => INTAKE_FIELDS[c.trim().toLowerCase()]).length >= 3;
  let map = mapFor(grid[0] ?? []);
  const out: IntakeRow[] = [];
  for (const row of grid.slice(1)) {
    if (looksLikeHeader(row)) {
      // A partial header (only the new columns) keeps the old names for the rest.
      map = map.map((old, i) => INTAKE_FIELDS[(row[i] ?? "").trim().toLowerCase()] ?? old);
      continue;
    }
    const r: IntakeRow = {
      submittedAt: null, authorized: false, name: "", birthDate: null, mssName: null, attendingPhysician: null,
      parentEducation: null, parentOccupation: null, householdIncome: null, parentEmployment: null, housingType: null, links: {},
    };
    row.forEach((cell, i) => {
      const field = map[i];
      const v = clean(cell);
      if (!field || !v) return;
      if (field === "submittedAt") r.submittedAt = formTimestamp(v);
      else if (field === "authorized") r.authorized = /authori[sz]e/i.test(v);
      else if (field === "birthDate") r.birthDate = sheetDate(v);
      else if (field === "photo" || field === "parentId" || field === "medicalCertificate") {
        if (/^https?:\/\//i.test(v)) r.links[field] = v;
      } else (r as unknown as Record<string, string>)[field] = v;
    });
    if (r.name) out.push(r);
  }
  return out;
}

/** The form's latest response for a child: same birthday, and their first and last names among its words. */
export function intakeFor(
  patient: { firstName: string; lastName: string; birthDate: string | null },
  rows: readonly IntakeRow[]
): IntakeRow | null {
  if (!patient.birthDate) return null;
  const last = normalizeName(patient.lastName).split(" ").filter(Boolean).pop();
  const first = normalizeName(patient.firstName).split(" ")[0];
  if (!last || !first) return null;
  const hits = rows.filter((r) => {
    if (r.birthDate !== patient.birthDate) return false;
    const words = new Set(normalizeName(r.name).split(" "));
    return words.has(last) && words.has(first);
  });
  return hits.sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))[0] ?? null;
}

// ---------------------------------------------------------------------
// What changes on a record
// ---------------------------------------------------------------------

/** The patient columns the sheet owns, as the app stores them. */
export interface PatientMasterFields {
  patient_number: string | null;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  sex: string;
  raw_address: string | null;
  province_id: string | null;
  status: string;
  illness_code: string | null;
  illness_type: string | null;
  treatment_phase_id: string | null;
  marital_status: string | null;
  remarks: string | null;
  priority: string | null;
  legacy_code: string | null;
  admitted_at: string;
  distance_km: number | null;
  mss_name: string | null;
  attending_physician: string | null;
  parent_education: string | null;
  parent_occupation: string | null;
  household_income: string | null;
  parent_employment: string | null;
  housing_type: string | null;
  consent_authorized_at: string | null;
}

export interface OnFile {
  id: string;
  patient_number: string | null;
  first_name: string;
  last_name: string;
  birth_date: string | null;
}

export type MasterMatch = { kind: "cn" | "name"; id: string } | { kind: "new" } | { kind: "conflict"; reason: string };

/**
 * Which record a sheet row is: the one holding its CN; else a CN-less record
 * with the same name (and birthday, when both have one) -- a child admitted
 * in the app before the sheet listed them. Two such records, or a namesake
 * holding another CN, is a conflict for a person to settle, never a guess.
 */
export function matchMasterRow(row: MasterRow, onFile: readonly OnFile[]): MasterMatch {
  const byCn = onFile.find((p) => p.patient_number === row.cn);
  if (byCn) return { kind: "cn", id: byCn.id };
  const key = (first: string, last: string) => `${normalizeName(last)}|${normalizeName(first)}`;
  const want = key(row.firstName, row.lastName);
  const same = onFile.filter(
    (p) => key(p.first_name, p.last_name) === want && (!row.birthDate || !p.birth_date || p.birth_date === row.birthDate)
  );
  const free = same.filter((p) => p.patient_number === null);
  if (free.length === 1) return { kind: "name", id: free[0].id };
  if (free.length > 1) return { kind: "conflict", reason: `CN ${row.cn}: ${free.length} records without a CN share this name` };
  const taken = same.find((p) => p.birth_date && p.birth_date === row.birthDate);
  if (taken) return { kind: "conflict", reason: `CN ${row.cn}: the same child is on file as CN ${taken.patient_number}` };
  return { kind: "new" };
}

/**
 * What the sheet's values would change on the record: only what differs,
 * and a blank cell has no say. (Once the sheet won with it; since 0064 it
 * decides what a proposal would write.)
 */
export function masterPatch(
  want: Partial<PatientMasterFields>,
  have: PatientMasterFields
): Partial<PatientMasterFields> {
  const patch: Partial<PatientMasterFields> = {};
  for (const key of Object.keys(want) as (keyof PatientMasterFields)[]) {
    const v = want[key];
    if (v === null || v === undefined || v === "") continue;
    const current = have[key];
    // Instants come back from Postgres in UTC; the sheet's are Manila time.
    const same =
      typeof v === "number"
        ? Number(current) === v
        : key.endsWith("_at") && current
          ? Date.parse(String(current)) === Date.parse(v)
          : current === v;
    if (!same) (patch as Record<string, unknown>)[key] = v;
  }
  return patch;
}

// ---------------------------------------------------------------------
// The copy sheet (Master Plan step 3): the app's records, in the
// original's columns, for the copy's script to write in.
// ---------------------------------------------------------------------

/** The original's 22 columns in order, then the app's two. AUA and PA are the copy's own formulas and are never written. */
export const COPY_HEADER = [
  "CN", "DE", "NAME", "BD", "AUA", "PA", "AB", "S", "ADD", "P/C", "R", "PS",
  "I", "D", "TP", "CARER", "RX", "CP", "MS", "P", "REMARKS", "CODE", "LFCN", "LAST UPDATED",
] as const;
export const COPY_FORMULA_COLUMNS = ["AUA", "PA"] as const;

const STATUS_LABEL: Record<string, string> = {
  ongoing: "On-going Treatment",
  expired: "Expired",
  non_pedia: "Non-Pedia",
  check_up: "Check Up",
  completed: "Completed",
  lost_to_follow_up: "Lost to Follow-up",
};

/** "Region IV-A" -> "RIV-A", "NCR" -> "NCR": the sheet's R column. */
export function regionCode(region: string | null): string | null {
  if (!region) return null;
  const m = /^Region\s+([IVX]+)(?:-([AB]))?$/i.exec(region.trim());
  return m ? `R${m[1].toUpperCase()}${m[2] ? `-${m[2].toUpperCase()}` : ""}` : region.trim();
}

/** "2024-06-27" -> "6/27/2024", how the sheet writes dates. */
export function sheetDateText(iso: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : null;
}

/** Whole years between two ISO dates. */
function ageOn(birth: string, today: string): number {
  const [by, bm, bd] = birth.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = today.slice(0, 10).split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

/** One child as the app holds them, with the names already looked up. */
export interface CopyRecord {
  cn: string | null;
  caseNumber: string | null;
  admittedOn: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  sex: string | null;
  address: string | null;
  province: string | null;
  region: string | null;
  status: string;
  illnessCode: string | null;
  diagnosis: string | null;
  phase: string | null;
  carerName: string | null;
  carerRelationship: string | null;
  carerPhone: string | null;
  maritalStatus: string | null;
  priority: string | null;
  remarks: string | null;
  legacyCode: string | null;
  /** Manila time, already formatted for the sheet. */
  lastUpdated: string;
  /** The row as the original last read it (ops.patients.sheet_row), if it is on the original. */
  sheetRow: Record<string, string> | null;
}

/**
 * The copy's row for one child. A column keeps the original's own words
 * while they still mean what the app holds ("BCell ALL" for Acute
 * Lymphoblastic Leukemia, "9171234567" for 09171234567), so the copy and
 * the original differ only where the records really differ.
 */
export function copyRow(r: CopyRecord, today: string): (string | null)[] {
  const raw = r.sheetRow ?? {};
  const eq = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null);
  const upper = (v: string | undefined) => clean(v)?.toUpperCase() ?? null;
  // The sheet's text when it still means the app's value, or when the app holds nothing there to
  // contradict it (a region with no province, say); else the app's value written the sheet's way.
  const pick = (col: string, same: (cell: string) => boolean, app: string | null) => {
    const cell = raw[col];
    return cell !== undefined && (app === null || same(cell)) ? cell : app;
  };
  const name = `${r.lastName}, ${r.firstName}`.replace(/,\s*$/, "");
  const bracket = r.birthDate ? sheetAgeBracket(ageOn(r.birthDate, today)) : null;
  const cells: Record<(typeof COPY_HEADER)[number], string | null> = {
    CN: r.cn,
    DE: pick("DE", (c) => sheetDate(c) === r.admittedOn, sheetDateText(r.admittedOn)),
    NAME: pick("NAME", (c) => { const s = splitName(c); return normalizeName(s.first) === normalizeName(r.firstName) && normalizeName(s.last) === normalizeName(r.lastName); }, name),
    BD: pick("BD", (c) => sheetDate(c) === r.birthDate, sheetDateText(r.birthDate)),
    AUA: null,
    PA: null,
    AB: pick("AB", (c) => c.trim() === bracket, bracket),
    S: pick("S", (c) => eq(upper(c), r.sex), r.sex),
    ADD: pick("ADD", (c) => eq(clean(c), r.address), r.address),
    "P/C": pick("P/C", (c) => !!r.province && provinceKey(c) === provinceKey(r.province), r.province),
    R: pick("R", (c) => eq(regionName(c), r.region), regionCode(r.region)),
    PS: pick("PS", (c) => STATUS_MAP[c.trim().toLowerCase()] === r.status, STATUS_LABEL[r.status] ?? r.status),
    I: pick("I", (c) => eq(upper(c), r.illnessCode), r.illnessCode),
    D: pick("D", (c) => !!r.diagnosis && diagnosisKey(c) === diagnosisKey(r.diagnosis), r.diagnosis),
    // "Expired" (or a blank) in TP is never a phase, so the app has nothing to say against it.
    TP: pick("TP", (c) => phaseKey(c) === null || phaseKey(c) === phaseKey(r.phase), r.phase),
    CARER: pick("CARER", (c) => !!r.carerName && normalizeName(c) === normalizeName(r.carerName), r.carerName),
    RX: pick("RX", (c) => eq(clean(c), r.carerRelationship), r.carerRelationship),
    CP: pick("CP", (c) => eq(normalizePhone(c), r.carerPhone), r.carerPhone),
    MS: pick("MS", (c) => eq(upper(c), r.maritalStatus), r.maritalStatus),
    P: pick("P", (c) => eq(upper(c), r.priority), r.priority),
    REMARKS: pick("REMARKS", (c) => eq(clean(c), r.remarks), r.remarks),
    CODE: pick("CODE", (c) => eq(clean(c), r.legacyCode), r.legacyCode),
    LFCN: r.caseNumber,
    "LAST UPDATED": r.lastUpdated,
  };
  return COPY_HEADER.map((h) => cells[h]);
}

/** CN order, then the children the original does not list yet (by LFCN): the cue to add them. */
export function copyOrder(a: CopyRecord, b: CopyRecord): number {
  if (a.cn && b.cn) return Number(a.cn) - Number(b.cn);
  if (a.cn || b.cn) return a.cn ? -1 : 1;
  return (a.caseNumber ?? "").localeCompare(b.caseNumber ?? "");
}

// ---------------------------------------------------------------------
// Changes on the original (user, 2026-09-24): the app is the record; an
// edit on the original sheet is a PROPOSAL a person applies or dismisses.
// ---------------------------------------------------------------------

/** What a person reviews: one field of a child, and the sheet columns it is read from. */
export const SHEET_FIELDS = {
  name: { label: "Name", columns: ["NAME"] },
  admitted: { label: "Date of entry", columns: ["DE"] },
  birthday: { label: "Birthday", columns: ["BD"] },
  sex: { label: "Sex", columns: ["S"] },
  address: { label: "Address", columns: ["ADD"] },
  province: { label: "Province / region", columns: ["P/C", "R"] },
  status: { label: "Status", columns: ["PS"] },
  illness: { label: "Type of illness", columns: ["I"] },
  diagnosis: { label: "Diagnosis", columns: ["D"] },
  phase: { label: "Treatment phase", columns: ["TP"] },
  carer: { label: "Carer", columns: ["CARER", "RX", "CP"] },
  marital: { label: "Marital status", columns: ["MS"] },
  priority: { label: "Priority", columns: ["P"] },
  remarks: { label: "Remarks", columns: ["REMARKS"] },
  code: { label: "Old code", columns: ["CODE"] },
} as const;
export type SheetField = keyof typeof SHEET_FIELDS;

/**
 * The fields someone changed on the original since it was last read. A cell
 * emptied on the sheet has no say (it never proposes erasing the app's
 * value). No baseline yet -- a child the app met first, now on the sheet --
 * means every field the sheet fills is looked at once.
 */
export function changedSheetFields(before: Record<string, string> | null, now: Record<string, string>): SheetField[] {
  const cell = (row: Record<string, string> | null, c: string) => (row?.[c] ?? "").trim();
  return (Object.keys(SHEET_FIELDS) as SheetField[]).filter((f) => {
    const cols = SHEET_FIELDS[f].columns as readonly string[];
    if (!cols.some((c) => cell(now, c))) return false;
    return before === null || cols.some((c) => cell(before, c) !== cell(now, c));
  });
}

/** A field's cells as the sheet shows them, e.g. "Dela Cruz, Ana · Mother · 9171234567". */
export function sheetFieldText(row: Record<string, string> | null, field: SheetField): string {
  return (SHEET_FIELDS[field].columns as readonly string[]).map((c) => (row?.[c] ?? "").trim()).filter(Boolean).join(" · ");
}

/** A patient row as the database returns it, the columns the copy needs. */
export interface PatientRowForCopy {
  id: string;
  patient_number: string | null;
  case_number: string | null;
  admitted_at: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  sex: string | null;
  raw_address: string | null;
  province_id: string | null;
  status: string;
  illness_code: string | null;
  treatment_phase_id: string | null;
  marital_status: string | null;
  priority: string | null;
  remarks: string | null;
  legacy_code: string | null;
  sheet_row: Record<string, string> | null;
}

/** Names looked up by id, and each child's current carers (oldest first). */
export interface CopyLookups {
  province: (id: string | null) => { name: string; region: string | null } | undefined;
  diagnosisName: (patientId: string) => string | null;
  phaseName: (id: string | null) => string | null;
  carers: (patientId: string) => { name: string; relationship: string | null; mobile_number: string | null }[];
}

/** The child as the copy shows them (shared by the export and the sheet-change review). */
export function copyRecordOf(p: PatientRowForCopy, l: CopyLookups, lastUpdated: string): CopyRecord {
  const carers = l.carers(p.id);
  // The carer the original names, else the longest-standing current one.
  const sheetCarer = p.sheet_row?.CARER ? normalizeName(p.sheet_row.CARER) : null;
  const carer = carers.find((c) => normalizeName(c.name) === sheetCarer) ?? carers[0];
  const prov = l.province(p.province_id);
  return {
    cn: p.patient_number,
    caseNumber: p.case_number,
    admittedOn: p.admitted_at,
    firstName: p.first_name,
    lastName: p.last_name,
    birthDate: p.birth_date,
    sex: p.sex,
    address: p.raw_address,
    province: prov?.name ?? null,
    region: prov?.region ?? null,
    status: p.status,
    illnessCode: p.illness_code,
    diagnosis: l.diagnosisName(p.id),
    phase: l.phaseName(p.treatment_phase_id),
    carerName: carer?.name ?? null,
    carerRelationship: carer?.relationship ?? null,
    carerPhone: carer?.mobile_number ?? null,
    maritalStatus: p.marital_status,
    priority: p.priority,
    remarks: p.remarks,
    legacyCode: p.legacy_code,
    lastUpdated,
    sheetRow: p.sheet_row,
  };
}

/** The app's value of one field, in the copy's words (what "the app has now" means in a review). */
export function appFieldText(record: CopyRecord, field: SheetField, today: string): string {
  const row = copyRow(record, today);
  return (SHEET_FIELDS[field].columns as readonly string[])
    .map((c) => row[COPY_HEADER.indexOf(c as (typeof COPY_HEADER)[number])] ?? "")
    .filter(Boolean)
    .join(" · ");
}
