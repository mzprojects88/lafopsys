// Imports the cleaned Employee 201 Masterlist into the hr schema (0036).
//
// Source: ../DATA/clean/employee-201.json from scripts/clean-employee-201.py
// -- outside the repo, personal and sensitive personal information (RA
// 10173); never copy it into the repo.
//
// For each row: hr.employees (+ the opening "hired" event and, for a
// separated person, the "separated" event), hr.employee_private,
// hr.compensation from the basic salary (fixed monthly, factor 365, 8 h), and
// hr.employee_documents for every Drive link. The record is linked to the
// shared.staff login whose normalised first + last name matches exactly one
// account, and that account's hire_date (an account-creation date until now)
// is replaced with the real one. Ambiguous or unmatched names are reported
// for HR to link by hand from the employee's page.
//
// Idempotent on employee_code: a row already imported is skipped and listed.
// Nothing is updated or deleted.
//
// Usage: node --env-file=.env.local scripts/import-employee-201.mjs [--dry-run]

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const dryRun = process.argv.includes("--dry-run");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const people = JSON.parse(readFileSync(resolve(process.cwd(), "../DATA/clean/employee-201.json"), "utf8"));

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const fail = (msg, error) => {
  console.error(`${msg}: ${error.message}`);
  process.exit(1);
};

const { data: staff, error: staffError } = await admin.schema("shared").from("staff").select("id, first_name, last_name, role, position, active, staff_code, hire_date");
if (staffError) fail("Failed to read shared.staff", staffError);

let { data: existing, error: existingError } = await admin.schema("hr").from("employees").select("id, employee_code, staff_id");
if (existingError) {
  // Before 0036 is applied the schema is not there; a dry run can still show
  // how the names would match.
  if (!dryRun) fail("Failed to read hr.employees (has 0036 been applied?)", existingError);
  console.warn(`hr.employees not readable yet (${existingError.message}); matching against an empty table.`);
  existing = [];
}
const existingByCode = new Map(existing.map((e) => [e.employee_code, e]));
const linkedStaff = new Set(existing.map((e) => e.staff_id).filter(Boolean));

const report = { imported: [], skipped: [], matched: [], unmatched: [], ambiguous: [], staffWithoutRecord: [] };

for (const p of people) {
  const e = p.employee;
  if (existingByCode.has(e.employee_code)) {
    report.skipped.push(e.employee_code);
    if (existingByCode.get(e.employee_code).staff_id) linkedStaff.add(existingByCode.get(e.employee_code).staff_id);
    continue;
  }

  // Match on first + last, then on last + first token of first name, so
  // "Riza Joy" on the sheet still finds "Riza" on the roster.
  const full = norm(`${e.first_name} ${e.last_name}`);
  const short = norm(`${e.first_name.split(" ")[0]} ${e.last_name}`);
  const candidates = staff.filter((s) => !linkedStaff.has(s.id) && (norm(`${s.first_name} ${s.last_name}`) === full || norm(`${s.first_name.split(" ")[0]} ${s.last_name}`) === short));
  let staffId = null;
  if (candidates.length === 1) {
    staffId = candidates[0].id;
    report.matched.push(`${e.employee_code} -> ${candidates[0].staff_code} (${candidates[0].role})`);
  } else if (candidates.length > 1) {
    report.ambiguous.push(`${e.employee_code}: ${candidates.map((c) => c.staff_code).join(", ")}`);
  } else {
    report.unmatched.push(`${e.employee_code} (${e.status})`);
  }

  if (dryRun) {
    report.imported.push(`${e.employee_code} (dry run)`);
    if (staffId) linkedStaff.add(staffId);
    continue;
  }

  const { data: created, error: insertError } = await admin
    .schema("hr")
    .from("employees")
    .insert({
      employee_code: e.employee_code,
      staff_id: staffId,
      first_name: e.first_name,
      middle_name: e.middle_name,
      last_name: e.last_name,
      position: e.position,
      department: e.department,
      employment_type: e.employment_type,
      status: e.status,
      hire_date: e.hire_date,
      separation_date: e.separation_date,
      birthdate: e.birthdate,
      civil_status: e.civil_status,
      contact_number: e.contact_number,
      email: e.email,
      address: e.address,
      emergency_contact: e.emergency_contact ?? {},
      notes: e.notes,
    })
    .select("id")
    .single();
  if (insertError) fail(`Insert ${e.employee_code}`, insertError);
  const employeeId = created.id;
  if (staffId) linkedStaff.add(staffId);

  // History: hired, and separated where the sheet says so. The trigger
  // re-derives status/dates on hr.employees from the latest event, which
  // matches what was just inserted.
  const events = [{ employee_id: employeeId, kind: "hired", effective_on: e.hire_date, employment_type: e.employment_type, status: "active", position: e.position, reason: "From the 201 masterlist" }];
  if ((e.status === "resigned" || e.status === "terminated") && e.separation_date) {
    events.push({
      employee_id: employeeId,
      kind: "separated",
      effective_on: e.separation_date,
      status: e.status,
      separation_cause: e.status === "resigned" ? "resignation" : "just_cause",
      reason: "From the 201 masterlist (cause not recorded there; confirm)",
    });
  }
  const { error: eventsError } = await admin.schema("hr").from("employment_events").insert(events);
  if (eventsError) fail(`Events for ${e.employee_code}`, eventsError);

  const { error: privateError } = await admin.schema("hr").from("employee_private").insert({ employee_id: employeeId, ...p.private });
  if (privateError) fail(`Private record for ${e.employee_code}`, privateError);

  if (p.pay.basic_monthly !== null) {
    const { error: compError } = await admin.schema("hr").from("compensation").insert({
      employee_id: employeeId,
      effective_from: e.hire_date,
      pay_basis: "monthly",
      basic_monthly: p.pay.basic_monthly,
      days_factor: 365,
      hours_per_day: 8,
      allowances: p.pay.allowances,
      is_minimum_wage_earner: false,
      reason: "From the 201 masterlist",
    });
    if (compError) fail(`Compensation for ${e.employee_code}`, compError);
  }

  if (p.documents.length) {
    const { error: docsError } = await admin.schema("hr").from("employee_documents").insert(p.documents.map((d) => ({ employee_id: employeeId, ...d })));
    if (docsError) fail(`Documents for ${e.employee_code}`, docsError);
  }

  if (staffId) {
    const { error: hireError } = await admin.schema("shared").from("staff").update({ hire_date: e.hire_date }).eq("id", staffId);
    if (hireError) fail(`hire_date for ${e.employee_code}`, hireError);
  }

  report.imported.push(e.employee_code);
}

// The other direction: logins that are paid but have no 201 record. The
// system account is not a person.
for (const s of staff) {
  if (!s.active || linkedStaff.has(s.id) || /super\s*admin/i.test(`${s.first_name} ${s.last_name}`) || s.staff_code === "superadmin") continue;
  report.staffWithoutRecord.push(`${s.staff_code} (${s.role}, ${s.position})`);
}

console.log(`${dryRun ? "[dry run] " : ""}Employee 201 import`);
console.log(`  imported: ${report.imported.length}${report.imported.length ? " — " + report.imported.join(", ") : ""}`);
console.log(`  skipped (already imported): ${report.skipped.length}${report.skipped.length ? " — " + report.skipped.join(", ") : ""}`);
console.log(`  linked to a login: ${report.matched.length}`);
for (const m of report.matched) console.log(`    ${m}`);
console.log(`  no login found: ${report.unmatched.length}`);
for (const m of report.unmatched) console.log(`    ${m}`);
console.log(`  ambiguous (link by hand): ${report.ambiguous.length}`);
for (const m of report.ambiguous) console.log(`    ${m}`);
console.log(`  logins with no 201 record: ${report.staffWithoutRecord.length}`);
for (const m of report.staffWithoutRecord) console.log(`    ${m}`);
