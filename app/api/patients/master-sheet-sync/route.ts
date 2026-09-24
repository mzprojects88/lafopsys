import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dayKey } from "@/lib/utils/dtr";
import { indexPatients, matchDeterministic, normalizeName, type PatientRef } from "@/lib/utils/house-sheet";
import { adjudicatePatientMatch, explainSheetChanges } from "@/lib/ai/openai";
import { openaiConfigured } from "@/lib/ai/env";
import {
  ILLNESS_TYPE_LABEL,
  MASTER_TABS,
  SHEET_FIELDS,
  appFieldText,
  caseNumberFromCode,
  changedSheetFields,
  copyRecordOf,
  diagnosisCategory,
  diagnosisKey,
  intakeFor,
  masterCsvUrl,
  masterPatch,
  matchMasterRow,
  parseDistanceCsv,
  parseIntakeCsv,
  parseMasterCsv,
  phaseKey,
  provinceKey,
  refId,
  regionName,
  sheetFieldText,
  type CopyLookups,
  type MasterRow,
  type OnFile,
  type PatientMasterFields,
  type PatientRowForCopy,
  type SheetField,
} from "@/lib/utils/master-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUNNING_GUARD_MS = 5 * 60_000;
const AI_BUDGET_MS = 120_000;
const AI_BATCH = 20;

/** jsonb hands keys back in its own order; compare by content. */
const sameCells = (a: Record<string, string>, b: unknown) => {
  if (!b || typeof b !== "object") return false;
  const o = b as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(o).length && keys.every((k) => o[k] === a[k]);
};

/**
 * Reads LAF's original Patients Database sheet (read only, never written)
 * for REFERENCE. The app is the record (user, 2026-09-24): an edit made on
 * the original since the last read becomes a proposal in ops.sheet_changes
 * (0064) -- one per child and field, or one per new child -- explained by
 * OpenAI, for a person to apply or dismiss (app/api/patients/sheet-changes).
 * Nothing on the sheet overwrites the app. Still automatic, because nothing
 * in the app competes with them: the sheet's CN on a child the app admitted
 * first, the LFCN from the old CODE, the Extract distance and the intake
 * form's fields (fill-only), and the stored copy of each row (0059).
 *
 * Called by pg_cron at :15 and :45 with the bearer secret (0057), and by
 * "Sync now". `dryRun: true` finds and counts but writes nothing.
 */
export async function POST(request: Request) {
  let body: { force?: unknown; dryRun?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // An empty body is fine.
  }
  const force = body.force === true;
  const dryRun = body.dryRun === true;

  let trigger: "cron" | "manual";
  let triggeredBy: string | null = null;
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer !== undefined) {
    const expected = process.env.CALENDAR_SYNC_SECRET;
    if (!expected) return NextResponse.json({ ok: false, error: "CALENDAR_SYNC_SECRET is not configured on the server." }, { status: 500 });
    const a = Buffer.from(bearer);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
    trigger = "cron";
  } else {
    const session = await createClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    const { data: canEdit } = await session.schema("shared").rpc("module_editable", { p_module: "patients" });
    if (canEdit !== true) return NextResponse.json({ ok: false, error: "Your access to Patients is view only." }, { status: 403 });
    trigger = "manual";
    triggeredBy = user.id;
  }

  const admin = createAdminClient();
  const ops = () => admin.schema("ops");

  const { data: settings } = await admin.schema("shared").from("app_settings").select("master_sheet_sync_enabled").eq("id", true).maybeSingle();
  if (!dryRun && settings && settings.master_sheet_sync_enabled === false) return NextResponse.json({ ok: true, skipped: "disabled" });

  const { data: running } = await ops()
    .from("master_sheet_sync_runs")
    .select("id")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - RUNNING_GUARD_MS).toISOString())
    .limit(1);
  if (running && running.length > 0) return NextResponse.json({ ok: false, error: "A sync is already running." }, { status: 409 });

  let runId: string | null = null;
  if (!dryRun) {
    const { data: run, error } = await ops().from("master_sheet_sync_runs").insert({ trigger, triggered_by: triggeredBy }).select("id").single();
    if (error || !run) return NextResponse.json({ ok: false, error: error?.message ?? "Could not record the run." }, { status: 500 });
    runId = run.id as string;
  }
  const finish = async (fields: Record<string, unknown>) => {
    if (runId) await ops().from("master_sheet_sync_runs").update({ ...fields, finished_at: new Date().toISOString() }).eq("id", runId);
  };

  try {
    const fetchCsv = async (gid: string) => {
      const response = await fetch(masterCsvUrl(gid), { cache: "no-store", redirect: "follow", headers: { accept: "text/csv" } });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/csv")) {
        throw new Error(`Google returned ${response.status} ${contentType || "(no content type)"} -- is the Patients Database still shared as "anyone with the link"?`);
      }
      return response.text();
    };
    const [masterCsv, extractCsv, intakeCsv] = await Promise.all([fetchCsv(MASTER_TABS.patients), fetchCsv(MASTER_TABS.extract), fetchCsv(MASTER_TABS.intake)]);
    const hash = createHash("sha256").update(masterCsv).update("\0").update(extractCsv).update("\0").update(intakeCsv).digest("hex");

    if (!force && !dryRun) {
      const { data: last } = await ops()
        .from("master_sheet_sync_runs")
        .select("csv_hash, rows_seen")
        .in("status", ["success", "unchanged"])
        .neq("id", runId!)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.csv_hash === hash) {
        await finish({ status: "unchanged", csv_hash: hash, rows_seen: last.rows_seen ?? 0 });
        return NextResponse.json({ ok: true, status: "unchanged" });
      }
    }

    const parsed = parseMasterCsv(masterCsv);
    if (parsed.rows.length === 0) throw new Error(parsed.problems[0] ?? "The Patients Database tab has no rows.");
    const distance = parseDistanceCsv(extractCsv);
    const intake = parseIntakeCsv(intakeCsv);
    // notes: the sheet needs a person's eye (no CN, a conflict); errors: a write failed.
    const notes = [...parsed.problems];
    const errors: string[] = [];

    // ---- what is on file ----
    const [patientsQ, carersQ, dxLinksQ, diagnosesQ, provincesQ, phasesQ, pendingQ] = await Promise.all([
      ops().from("patients").select("*"),
      ops().from("carers").select("id, patient_id, name, relationship, mobile_number, effective_from").is("effective_to", null).order("effective_from"),
      ops().from("patient_diagnoses").select("patient_id, diagnosis_id"),
      ops().from("diagnoses").select("id, name"),
      ops().from("provinces").select("id, name, region"),
      ops().from("treatment_phases").select("id, name"),
      ops().from("sheet_changes").select("id, kind, patient_id, field, sheet_cn, sheet_after").eq("status", "pending"),
    ]);
    for (const q of [patientsQ, carersQ, dxLinksQ, diagnosesQ, provincesQ, phasesQ, pendingQ]) if (q.error) throw new Error(q.error.message);

    type PatientDb = PatientMasterFields &
      PatientRowForCopy & { id: string; case_number: string | null; intake_links: unknown; sheet_row: Record<string, string> | null };
    const patients = (patientsQ.data ?? []) as PatientDb[];
    const byId = new Map(patients.map((p) => [p.id, p]));
    const onFile: OnFile[] = patients.map((p) => ({ id: p.id, patient_number: p.patient_number, first_name: p.first_name, last_name: p.last_name, birth_date: p.birth_date }));
    type CarerDb = { id: string; patient_id: string; name: string; relationship: string | null; mobile_number: string | null };
    const carersOf = new Map<string, CarerDb[]>();
    for (const c of (carersQ.data ?? []) as CarerDb[]) carersOf.set(c.patient_id, [...(carersOf.get(c.patient_id) ?? []), c]);
    const dxOf = new Map<string, string[]>();
    for (const l of (dxLinksQ.data ?? []) as { patient_id: string; diagnosis_id: string }[]) dxOf.set(l.patient_id, [...(dxOf.get(l.patient_id) ?? []), l.diagnosis_id]);
    const takenCase = new Set(patients.map((p) => p.case_number).filter((c): c is string => !!c));
    type Pending = { id: string; kind: "field" | "new_child"; patient_id: string | null; field: SheetField | null; sheet_cn: string; sheet_after: string };
    const pending = (pendingQ.data ?? []) as Pending[];

    // ---- reference lists: find by name, add what is missing ----
    let referenceAdded = 0;
    const refs = (rows: { id: string; name: string }[], key: (n: string) => string) => ({
      byKey: new Map(rows.map((r) => [key(r.name), r.id])),
      ids: new Set(rows.map((r) => r.id)),
      names: new Map(rows.map((r) => [r.id, r.name])),
    });
    const dx = refs((diagnosesQ.data ?? []) as { id: string; name: string }[], diagnosisKey);
    const phase = refs((phasesQ.data ?? []) as { id: string; name: string }[], (n) => phaseKey(n) ?? "");
    const provinceRows = (provincesQ.data ?? []) as { id: string; name: string; region: string | null }[];
    const prov = refs(provinceRows, provinceKey);
    const provinceById = new Map(provinceRows.map((p) => [p.id, p]));

    // A list entry the sheet names that the app lacks is added now (a list
    // entry, not a child's data), so the proposal can point at it.
    const ensure = async (
      table: "diagnoses" | "treatment_phases" | "provinces",
      list: ReturnType<typeof refs>,
      prefix: string,
      key: string,
      name: string,
      extra: Record<string, unknown> = {}
    ): Promise<string | null> => {
      const found = list.byKey.get(key);
      if (found) return found;
      const id = refId(prefix, name, list.ids);
      list.ids.add(id);
      list.byKey.set(key, id);
      list.names.set(id, name);
      referenceAdded += 1;
      if (dryRun) return id;
      const { error } = await ops().from(table).insert({ id, name, ...extra });
      if (error) {
        errors.push(`add ${table} "${name}": ${error.message}`);
        list.byKey.delete(key);
        return null;
      }
      if (table === "provinces") provinceById.set(id, { id, name, region: null });
      return id;
    };

    const lookups: CopyLookups = {
      province: (id) => (id ? provinceById.get(id) : undefined),
      diagnosisName: (pid) => {
        const id = (dxOf.get(pid) ?? [])[0];
        return id ? (dx.names.get(id) ?? null) : null;
      },
      phaseName: (id) => (id ? (phase.names.get(id) ?? null) : null),
      carers: (pid) => carersOf.get(pid) ?? [],
    };

    // Names for the duplicate check on new sheet rows (the House Sheet's matcher).
    const nameIndex = indexPatients(
      patients.map<PatientRef>((p) => ({
        id: p.id,
        patientNumber: p.case_number ?? p.patient_number ?? "",
        firstName: p.first_name,
        lastName: p.last_name,
        birthDate: p.birth_date,
        province: lookups.province(p.province_id)?.name ?? null,
        city: null,
        carerNames: (carersOf.get(p.id) ?? []).map((c) => c.name),
      }))
    );

    const counts = { changes: 0, newChildren: 0, unchanged: 0, skipped: 0, numbersAssigned: 0, linked: 0, resolved: 0 };
    const today = dayKey(new Date());
    const now = new Date().toISOString();
    const newChildAi: { id: string; row: MasterRow; candidates: PatientRef[] }[] = [];

    /** What applying one field would write, or null when the app already holds it. */
    const planField = async (row: MasterRow, have: PatientDb, field: SheetField): Promise<Record<string, unknown> | null> => {
      const patch = (want: Partial<PatientMasterFields>) => {
        const p = masterPatch(want, have);
        return Object.keys(p).length ? { patient: p } : null;
      };
      switch (field) {
        case "name":
          return patch({ first_name: row.firstName, last_name: row.lastName });
        case "admitted":
          return patch({ admitted_at: row.admittedOn ?? undefined });
        case "birthday":
          return patch({ birth_date: row.birthDate });
        case "sex":
          return patch({ sex: row.sex ?? undefined });
        case "address":
          return patch({ raw_address: row.address });
        case "status":
          return patch({ status: row.status ?? undefined });
        case "illness":
          return patch({ illness_code: row.illnessCode, illness_type: row.illnessCode ? ILLNESS_TYPE_LABEL[row.illnessCode] : null });
        case "marital":
          return patch({ marital_status: row.maritalStatus });
        case "priority":
          return patch({ priority: row.priority });
        case "remarks":
          return patch({ remarks: row.remarks });
        case "code":
          return patch({ legacy_code: row.legacyCode });
        case "province": {
          if (!row.province) return null;
          const id = await ensure("provinces", prov, "prov", provinceKey(row.province), row.province);
          const region = regionName(row.regionCode);
          const p = id ? provinceById.get(id) : undefined;
          if (id && region && p && !p.region && !dryRun) {
            p.region = region;
            await ops().from("provinces").update({ region }).eq("id", id).is("region", null);
          }
          return id ? patch({ province_id: id }) : null;
        }
        case "phase": {
          const key = phaseKey(row.phase);
          if (!key) return null;
          const id = await ensure("treatment_phases", phase, "phase", key, row.phase!);
          return id ? patch({ treatment_phase_id: id }) : null;
        }
        case "diagnosis": {
          if (!row.diagnosis) return null;
          const key = diagnosisKey(row.diagnosis);
          const current = dxOf.get(have.id) ?? [];
          if (current.some((id) => dx.byKey.get(key) === id)) return null;
          const id = await ensure("diagnoses", dx, "dx", key, row.diagnosis, { category: diagnosisCategory(row.diagnosis, row.illnessCode) });
          return id ? { diagnosisId: id } : null;
        }
        case "carer": {
          if (!row.carerName) return null;
          const carer = (carersOf.get(have.id) ?? []).find((c) => normalizeName(c.name) === normalizeName(row.carerName!));
          if (!carer) return { carerInsert: { name: row.carerName, relationship: row.carerRelationship, mobile_number: row.carerPhone, effective_from: today } };
          const upd: Record<string, string> = {};
          if (row.carerRelationship && row.carerRelationship !== carer.relationship) upd.relationship = row.carerRelationship;
          if (row.carerPhone && row.carerPhone !== carer.mobile_number) upd.mobile_number = row.carerPhone;
          return Object.keys(upd).length ? { carerUpdate: { id: carer.id, ...upd } } : null;
        }
      }
    };

    // Numbers from the old CODE first: a CODE-less child numbered first could take a CODE's number.
    const ordered = [...parsed.rows].sort((a, b) => Number(!caseNumberFromCode(a.legacyCode)) - Number(!caseNumberFromCode(b.legacyCode)));

    for (const row of ordered) {
      const match = matchMasterRow(row, onFile);
      if (match.kind === "conflict") {
        counts.skipped += 1;
        notes.push(match.reason);
        continue;
      }
      try {
        // ---- a child the app does not have: a proposal, with a duplicate check ----
        if (match.kind === "new") {
          if (!row.admittedOn) {
            counts.skipped += 1;
            notes.push(`CN ${row.cn}: not proposed yet, the sheet has no date of entry`);
            continue;
          }
          counts.newChildren += 1;
          if (dryRun) continue;
          const provinceId = row.province ? await ensure("provinces", prov, "prov", provinceKey(row.province), row.province) : null;
          const pKey = phaseKey(row.phase);
          const phaseId = pKey ? await ensure("treatment_phases", phase, "phase", pKey, row.phase!) : null;
          const dxId = row.diagnosis
            ? await ensure("diagnoses", dx, "dx", diagnosisKey(row.diagnosis), row.diagnosis, { category: diagnosisCategory(row.diagnosis, row.illnessCode) })
            : null;
          const form = intakeFor(row, intake);
          const fromCode = caseNumberFromCode(row.legacyCode);
          const payload = {
            insert: {
              first_name: row.firstName,
              last_name: row.lastName,
              birth_date: row.birthDate,
              sex: row.sex,
              raw_address: row.address,
              province_id: provinceId,
              status: row.status ?? "ongoing",
              illness_code: row.illnessCode,
              illness_type: row.illnessCode ? ILLNESS_TYPE_LABEL[row.illnessCode] : null,
              treatment_phase_id: phaseId,
              marital_status: row.maritalStatus,
              remarks: row.remarks,
              priority: row.priority,
              legacy_code: row.legacyCode,
              admitted_at: row.admittedOn,
              distance_km: distance.get(row.cn) ?? null,
              patient_number: row.cn,
              case_number: fromCode && !takenCase.has(fromCode) ? fromCode : null,
              mss_name: form?.mssName ?? null,
              attending_physician: form?.attendingPhysician ?? null,
              parent_education: form?.parentEducation ?? null,
              parent_occupation: form?.parentOccupation ?? null,
              household_income: form?.householdIncome ?? null,
              parent_employment: form?.parentEmployment ?? null,
              housing_type: form?.housingType ?? null,
              consent_authorized_at: form?.authorized ? form.submittedAt : null,
              intake_links: form && Object.keys(form.links).length ? form.links : null,
              sheet_row: row.raw,
            },
            diagnosisId: dxId,
            carerInsert: row.carerName ? { name: row.carerName, relationship: row.carerRelationship, mobile_number: row.carerPhone, effective_from: row.admittedOn } : null,
          };
          const after = `${row.lastName}, ${row.firstName}`;
          const existing = pending.find((p) => p.kind === "new_child" && p.sheet_cn === row.cn);
          if (existing) {
            const { error } = await ops().from("sheet_changes").update({ payload, sheet_row: row.raw, sheet_after: after }).eq("id", existing.id);
            if (error) errors.push(`CN ${row.cn} proposal: ${error.message}`);
            continue;
          }
          const { data, error } = await ops()
            .from("sheet_changes")
            .insert({ sheet_cn: row.cn, kind: "new_child", label: "New child on the sheet", sheet_after: after, payload, sheet_row: row.raw })
            .select("id")
            .single();
          if (error || !data) {
            errors.push(`CN ${row.cn} proposal: ${error?.message ?? "not saved"}`);
            continue;
          }
          const m = matchDeterministic(after, nameIndex);
          const named = m.kind === "candidates" ? m.candidates : [nameIndex.byId.get(m.patientId)].filter((c): c is PatientRef => !!c);
          const sameBirthday = row.birthDate ? patients.filter((p) => p.birth_date === row.birthDate).map((p) => nameIndex.byId.get(p.id)).filter((c): c is PatientRef => !!c) : [];
          const candidates = [...named, ...sameBirthday].filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);
          newChildAi.push({ id: data.id as string, row, candidates });
          continue;
        }

        // ---- a child the app has ----
        const have = byId.get(match.id)!;
        const auto: Record<string, unknown> = {};
        // Metadata, not staff data: the sheet's CN on a child the app admitted first, and the LFCN from the CODE.
        if (match.kind === "name") {
          auto.patient_number = row.cn;
          onFile.find((p) => p.id === have.id)!.patient_number = row.cn;
          counts.linked += 1;
        }
        const fromCode = caseNumberFromCode(row.legacyCode);
        if (!have.case_number && fromCode && !takenCase.has(fromCode)) {
          auto.case_number = fromCode;
          takenCase.add(fromCode);
          have.case_number = fromCode;
          counts.numbersAssigned += 1;
        }
        // Nothing in the app edits these, so the sheet's tabs still fill them (only where they differ).
        const form = intakeFor(row, intake);
        Object.assign(
          auto,
          masterPatch(
            {
              distance_km: distance.get(row.cn) ?? null,
              mss_name: form?.mssName ?? null,
              attending_physician: form?.attendingPhysician ?? null,
              parent_education: form?.parentEducation ?? null,
              parent_occupation: form?.parentOccupation ?? null,
              household_income: form?.householdIncome ?? null,
              parent_employment: form?.parentEmployment ?? null,
              housing_type: form?.housingType ?? null,
              consent_authorized_at: form?.authorized ? form.submittedAt : null,
            },
            have
          )
        );
        const links = form && Object.keys(form.links).length ? form.links : null;
        if (links && !sameCells(links as Record<string, string>, have.intake_links)) auto.intake_links = links;

        // What someone changed on the original since the last read, and does the app disagree?
        const before = have.sheet_row && typeof have.sheet_row === "object" ? have.sheet_row : null;
        let proposed = 0;
        for (const field of changedSheetFields(before, row.raw)) {
          const payload = await planField(row, have, field);
          const waiting = pending.find((p) => p.kind === "field" && p.patient_id === have.id && p.field === field);
          if (!payload) {
            // The app already holds it (someone entered it there too): nothing to review.
            if (waiting && !dryRun) {
              await ops().from("sheet_changes").update({ status: "applied", decided_at: now, decision_note: "Already in the app." }).eq("id", waiting.id);
              counts.resolved += 1;
            }
            continue;
          }
          proposed += 1;
          counts.changes += 1;
          if (dryRun) continue;
          const change = {
            sheet_before: before ? sheetFieldText(before, field) || null : null,
            sheet_after: sheetFieldText(row.raw, field),
            app_now: appFieldText(copyRecordOf(have, lookups, ""), field, today) || null,
            payload,
            sheet_row: row.raw,
          };
          if (waiting) {
            // A second edit before anyone looked: the proposal follows it, and is explained again.
            const again = waiting.sheet_after !== change.sheet_after ? { ai_summary: null, ai_flag: null, ai_error: null } : {};
            const { error } = await ops().from("sheet_changes").update({ ...change, ...again }).eq("id", waiting.id);
            if (error) errors.push(`CN ${row.cn} ${field}: ${error.message}`);
          } else {
            const { error } = await ops()
              .from("sheet_changes")
              .insert({ sheet_cn: row.cn, patient_id: have.id, kind: "field", field, label: SHEET_FIELDS[field].label, ...change });
            if (error) errors.push(`CN ${row.cn} ${field}: ${error.message}`);
          }
        }
        if (proposed === 0) counts.unchanged += 1;

        // The original as last read: the next run's baseline, and the copy's wording (0059).
        if (!sameCells(row.raw, have.sheet_row)) auto.sheet_row = row.raw;
        if (Object.keys(auto).length && !dryRun) {
          const { error } = await ops().from("patients").update({ ...auto, sheet_synced_at: now }).eq("id", have.id);
          if (error) errors.push(`CN ${row.cn}: ${error.message}`);
        }
      } catch (err) {
        counts.skipped += 1;
        errors.push(`CN ${row.cn}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ---- LFCN for records the CODE did not number: year of first admission ----
    for (const p of patients.filter((x) => !x.case_number)) {
      counts.numbersAssigned += 1;
      if (dryRun) continue;
      const { data: number, error } = await ops().rpc("next_case_number", { p_year: Number(String(p.admitted_at).slice(0, 4)) });
      if (error || !number) {
        errors.push(`number for ${p.id}: ${error?.message ?? "none returned"}`);
        continue;
      }
      await ops().from("patients").update({ case_number: number }).eq("id", p.id).is("case_number", null);
    }

    // ---- OpenAI: explain what changed, and check new rows against children on file ----
    let aiCalls = 0;
    if (!dryRun && openaiConfigured()) {
      const deadline = Date.now() + AI_BUDGET_MS;
      const { data: unexplained } = await ops()
        .from("sheet_changes")
        .select("id, label, sheet_before, sheet_after, app_now")
        .eq("status", "pending")
        .eq("kind", "field")
        .is("ai_summary", null)
        .limit(60);
      const items = (unexplained ?? []) as { id: string; label: string; sheet_before: string | null; sheet_after: string; app_now: string | null }[];
      for (let i = 0; i < items.length && Date.now() < deadline; i += AI_BATCH) {
        const batch = items.slice(i, i + AI_BATCH);
        aiCalls += 1;
        try {
          const answers = await explainSheetChanges(batch.map((b) => ({ id: b.id, label: b.label, before: b.sheet_before, after: b.sheet_after, appNow: b.app_now })));
          for (const a of answers) await ops().from("sheet_changes").update({ ai_summary: a.summary, ai_flag: a.flag, ai_error: null }).eq("id", a.id);
        } catch (err) {
          const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
          await ops().from("sheet_changes").update({ ai_error: message }).in("id", batch.map((b) => b.id));
        }
      }
      for (const n of newChildAi) {
        if (Date.now() > deadline) break;
        if (n.candidates.length === 0) {
          await ops().from("sheet_changes").update({ ai_flag: "new", ai_summary: "No child with a similar name or the same birthday is in the app." }).eq("id", n.id);
          continue;
        }
        aiCalls += 1;
        try {
          const a = await adjudicatePatientMatch({
            sheetName: `${n.row.lastName}, ${n.row.firstName}`,
            sheetCarer: n.row.carerName,
            sheetRelationship: n.row.carerRelationship,
            candidates: n.candidates.map((c) => ({
              id: c.id,
              name: `${c.lastName}, ${c.firstName}`,
              carerNames: c.carerNames,
              birthYear: c.birthDate ? Number(c.birthDate.slice(0, 4)) : null,
              province: c.province,
            })),
          });
          await ops()
            .from("sheet_changes")
            .update({
              ai_flag: a.decision === "none" ? "new" : "duplicate",
              ai_candidate_patient_id: a.patientId,
              ai_confidence: Math.round(a.confidence * 100) / 100,
              ai_summary: a.reason,
            })
            .eq("id", n.id);
        } catch (err) {
          await ops().from("sheet_changes").update({ ai_error: (err instanceof Error ? err.message : String(err)).slice(0, 300) }).eq("id", n.id);
        }
      }
    }

    const result = {
      rows_seen: parsed.rows.length,
      inserted: 0,
      updated: 0,
      unchanged: counts.unchanged,
      skipped: counts.skipped,
      reference_added: referenceAdded,
      numbers_assigned: counts.numbersAssigned,
      changes_found: counts.changes,
      new_children_found: counts.newChildren,
      details: { notes, errors, linked: counts.linked, resolved: counts.resolved, aiCalls },
    };
    if (dryRun) return NextResponse.json({ ok: true, dryRun: true, ...result });
    const failed = errors.length > 0;
    await finish({ status: failed ? "failed" : "success", csv_hash: hash, ...result, error: failed ? errors.join("\n").slice(0, 4000) : null });
    return NextResponse.json({ ok: !failed, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish({ status: "failed", error: message.slice(0, 4000) });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
