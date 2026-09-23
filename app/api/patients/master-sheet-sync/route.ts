import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dayKey } from "@/lib/utils/dtr";
import { normalizeName } from "@/lib/utils/house-sheet";
import {
  ILLNESS_TYPE_LABEL,
  MASTER_TABS,
  caseNumberFromCode,
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
  rowGaps,
  type OnFile,
  type PatientMasterFields,
} from "@/lib/utils/master-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RUNNING_GUARD_MS = 5 * 60_000;

/**
 * Reads LAF's Patients Database sheet (read only, never written) into
 * ops.patients: the sheet wins on every column it fills, a blank cell keeps
 * the app's value, and nothing is ever deleted. Stays, beds, arrivals and
 * orientation are the app's and are not touched.
 *
 * Called by pg_cron at :15 and :45 with the bearer secret (0057), and by a
 * social worker's or admin's "Sync now". `dryRun: true` reads and plans but
 * writes nothing, and answers with the counts -- the gate before a first run.
 *
 * Deciding lives in lib/utils/master-sheet.ts; this file fetches, writes and
 * records one row in ops.master_sheet_sync_runs per run.
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
    const [patientsQ, carersQ, dxLinksQ, diagnosesQ, provincesQ, phasesQ] = await Promise.all([
      ops().from("patients").select("*"),
      ops().from("carers").select("id, patient_id, name, relationship, mobile_number").is("effective_to", null),
      ops().from("patient_diagnoses").select("patient_id, diagnosis_id"),
      ops().from("diagnoses").select("id, name"),
      ops().from("provinces").select("id, name, region"),
      ops().from("treatment_phases").select("id, name"),
    ]);
    for (const q of [patientsQ, carersQ, dxLinksQ, diagnosesQ, provincesQ, phasesQ]) if (q.error) throw new Error(q.error.message);

    type PatientDb = PatientMasterFields & { id: string; case_number: string | null; intake_links: unknown };
    const patients = (patientsQ.data ?? []) as PatientDb[];
    const byId = new Map(patients.map((p) => [p.id, p]));
    const onFile: OnFile[] = patients.map((p) => ({ id: p.id, patient_number: p.patient_number, first_name: p.first_name, last_name: p.last_name, birth_date: p.birth_date }));
    type CarerDb = { id: string; patient_id: string; name: string; relationship: string | null; mobile_number: string | null };
    const carersOf = new Map<string, CarerDb[]>();
    for (const c of (carersQ.data ?? []) as CarerDb[]) carersOf.set(c.patient_id, [...(carersOf.get(c.patient_id) ?? []), c]);
    const dxOf = new Map<string, string[]>();
    for (const l of (dxLinksQ.data ?? []) as { patient_id: string; diagnosis_id: string }[]) dxOf.set(l.patient_id, [...(dxOf.get(l.patient_id) ?? []), l.diagnosis_id]);
    const takenCase = new Set(patients.map((p) => p.case_number).filter((c): c is string => !!c));

    // ---- reference lists: find by name, add what is missing ----
    let referenceAdded = 0;
    const refs = (rows: { id: string; name: string }[], key: (n: string) => string) => ({
      byKey: new Map(rows.map((r) => [key(r.name), r.id])),
      ids: new Set(rows.map((r) => r.id)),
    });
    const dx = refs((diagnosesQ.data ?? []) as { id: string; name: string }[], diagnosisKey);
    const phase = refs((phasesQ.data ?? []) as { id: string; name: string }[], (n) => phaseKey(n) ?? "");
    const provinceRows = (provincesQ.data ?? []) as { id: string; name: string; region: string | null }[];
    const prov = refs(provinceRows, provinceKey);
    const provinceRegion = new Map(provinceRows.map((p) => [p.id, p.region]));

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
      referenceAdded += 1;
      if (dryRun) return id;
      const { error } = await ops().from(table).insert({ id, name, ...extra });
      if (error) {
        errors.push(`add ${table} "${name}": ${error.message}`);
        list.byKey.delete(key);
        return null;
      }
      return id;
    };

    // ---- each child ----
    const counts = { inserted: 0, updated: 0, unchanged: 0, skipped: 0, numbersAssigned: 0 };
    const today = dayKey(new Date());
    const now = new Date().toISOString();
    // Numbers from the old CODE first: a CODE-less child inserted before them
    // would be numbered by the trigger and could take a CODE's number.
    const ordered = [...parsed.rows].sort((a, b) => Number(!caseNumberFromCode(a.legacyCode)) - Number(!caseNumberFromCode(b.legacyCode)));

    for (const row of ordered) {
      const match = matchMasterRow(row, onFile);
      if (match.kind === "conflict") {
        counts.skipped += 1;
        notes.push(match.reason);
        continue;
      }
      const gaps = rowGaps(row);
      if (match.kind === "new" && gaps.missing.length) {
        counts.skipped += 1;
        notes.push(`CN ${row.cn}: not added yet, the sheet has no ${gaps.missing.join(", ")}`);
        continue;
      }
      // Complete enough to keep, but the sheet still owes these; the next sync writes them.
      if (gaps.pending.length) notes.push(`CN ${row.cn}: the sheet has no ${gaps.pending.join(", ")} yet`);
      try {
        const provinceId = row.province ? await ensure("provinces", prov, "prov", provinceKey(row.province), row.province) : null;
        const region = regionName(row.regionCode);
        if (provinceId && region && !provinceRegion.get(provinceId)) {
          provinceRegion.set(provinceId, region);
          if (!dryRun) await ops().from("provinces").update({ region }).eq("id", provinceId).is("region", null);
        }
        const pKey = phaseKey(row.phase);
        const phaseId = pKey ? await ensure("treatment_phases", phase, "phase", pKey, row.phase!) : null;
        const form = intakeFor(row, intake);
        const want: Partial<PatientMasterFields> = {
          first_name: row.firstName,
          last_name: row.lastName,
          birth_date: row.birthDate,
          sex: row.sex ?? undefined,
          raw_address: row.address,
          province_id: provinceId,
          status: row.status ?? undefined,
          illness_code: row.illnessCode,
          illness_type: row.illnessCode ? ILLNESS_TYPE_LABEL[row.illnessCode] : null,
          treatment_phase_id: phaseId,
          marital_status: row.maritalStatus,
          remarks: row.remarks,
          priority: row.priority,
          legacy_code: row.legacyCode,
          admitted_at: row.admittedOn ?? undefined,
          distance_km: distance.get(row.cn) ?? null,
          mss_name: form?.mssName ?? null,
          attending_physician: form?.attendingPhysician ?? null,
          parent_education: form?.parentEducation ?? null,
          parent_occupation: form?.parentOccupation ?? null,
          household_income: form?.householdIncome ?? null,
          parent_employment: form?.parentEmployment ?? null,
          housing_type: form?.housingType ?? null,
          consent_authorized_at: form?.authorized ? form.submittedAt : null,
        };
        const links = form && Object.keys(form.links).length > 0 ? form.links : null;
        const fromCode = caseNumberFromCode(row.legacyCode);
        const codeNumber = fromCode && !takenCase.has(fromCode) ? fromCode : null;

        let patientId: string;
        let changed = false;
        if (match.kind === "new") {
          // A child new on the sheet is under treatment until the sheet says otherwise.
          const insert = { ...want, sex: row.sex, status: row.status ?? "ongoing", patient_number: row.cn, case_number: codeNumber, intake_links: links, sheet_synced_at: now };
          if (dryRun) {
            patientId = `new-${row.cn}`;
          } else {
            const { data, error } = await ops().from("patients").insert(insert).select("id, case_number").single();
            if (error || !data) throw new Error(error?.message ?? "insert returned nothing");
            patientId = data.id as string;
            if (data.case_number) takenCase.add(data.case_number as string);
          }
          if (codeNumber) takenCase.add(codeNumber);
          onFile.push({ id: patientId, patient_number: row.cn, first_name: row.firstName, last_name: row.lastName, birth_date: row.birthDate });
          counts.inserted += 1;
        } else {
          patientId = match.id;
          const have = byId.get(patientId)!;
          const patch: Record<string, unknown> = masterPatch(want, have);
          if (match.kind === "name") patch.patient_number = row.cn;
          if (!have.case_number && codeNumber) {
            patch.case_number = codeNumber;
            takenCase.add(codeNumber);
            counts.numbersAssigned += 1;
          }
          if (links && JSON.stringify(links) !== JSON.stringify(have.intake_links)) patch.intake_links = links;
          if (Object.keys(patch).length > 0) {
            changed = true;
            if (!dryRun) {
              const { error } = await ops().from("patients").update({ ...patch, sheet_synced_at: now }).eq("id", patientId);
              if (error) throw new Error(error.message);
            }
            Object.assign(have, patch);
            if (match.kind === "name") onFile.find((p) => p.id === patientId)!.patient_number = row.cn;
          }
        }

        // Diagnosis: one per child; the sheet's replaces a different one.
        if (row.diagnosis) {
          const key = diagnosisKey(row.diagnosis);
          const current = dxOf.get(patientId) ?? [];
          if (!current.some((id) => dx.byKey.get(key) === id)) {
            const dxId = await ensure("diagnoses", dx, "dx", key, row.diagnosis, { category: diagnosisCategory(row.diagnosis, row.illnessCode) });
            if (dxId) {
              changed = true;
              if (!dryRun) {
                if (current.length) await ops().from("patient_diagnoses").delete().eq("patient_id", patientId);
                const { error } = await ops().from("patient_diagnoses").insert({ patient_id: patientId, diagnosis_id: dxId });
                if (error) errors.push(`CN ${row.cn} diagnosis: ${error.message}`);
              }
              dxOf.set(patientId, [dxId]);
            }
          }
        }

        // Carer: the sheet's carer is on file with its relationship and phone. Other carers the app added stay.
        if (row.carerName) {
          const carer = (carersOf.get(patientId) ?? []).find((c) => normalizeName(c.name) === normalizeName(row.carerName!));
          if (carer) {
            const patch: Record<string, string> = {};
            if (row.carerRelationship && row.carerRelationship !== carer.relationship) patch.relationship = row.carerRelationship;
            if (row.carerPhone && row.carerPhone !== carer.mobile_number) patch.mobile_number = row.carerPhone;
            if (Object.keys(patch).length > 0) {
              changed = true;
              if (!dryRun) {
                const { error } = await ops().from("carers").update(patch).eq("id", carer.id);
                if (error) errors.push(`CN ${row.cn} carer: ${error.message}`);
              }
            }
          } else {
            changed = true;
            if (!dryRun) {
              const { error } = await ops()
                .from("carers")
                .insert({ patient_id: patientId, name: row.carerName, relationship: row.carerRelationship, mobile_number: row.carerPhone, effective_from: row.admittedOn ?? today });
              if (error) errors.push(`CN ${row.cn} carer: ${error.message}`);
            }
          }
        }

        if (match.kind !== "new") counts[changed ? "updated" : "unchanged"] += 1;
      } catch (err) {
        counts.skipped += 1;
        errors.push(`CN ${row.cn}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // ---- LFCN for records the CODE did not number: year of first admission ----
    const unnumbered = patients.filter((p) => !p.case_number);
    for (const p of unnumbered) {
      counts.numbersAssigned += 1;
      if (dryRun) continue;
      const { data: number, error } = await ops().rpc("next_case_number", { p_year: Number(String(p.admitted_at).slice(0, 4)) });
      if (error || !number) {
        errors.push(`number for ${p.id}: ${error?.message ?? "none returned"}`);
        continue;
      }
      const { error: upError } = await ops().from("patients").update({ case_number: number }).eq("id", p.id).is("case_number", null);
      if (upError) errors.push(`number for ${p.id}: ${upError.message}`);
    }

    const result = {
      rows_seen: parsed.rows.length,
      inserted: counts.inserted,
      updated: counts.updated,
      unchanged: counts.unchanged,
      skipped: counts.skipped,
      reference_added: referenceAdded,
      numbers_assigned: counts.numbersAssigned,
      details: { notes, errors },
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

