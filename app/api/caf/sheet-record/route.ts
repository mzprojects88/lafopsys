import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCsv } from "@/lib/utils/bank-statement";
import { cafRecordLines } from "@/lib/utils/caf-compare";
import { houseSheetCsvUrl } from "@/lib/utils/house-sheet";

export const dynamic = "force-dynamic";

/** "LAF Programs 2026", CAF Record tab: the nights staff listed per child per month. */
const PROGRAMS_SHEET_ID = "1_kprlQd0xMnYcmjuqU6sg-VT1glC1GBktpSkdm-KMN0";
const CAF_RECORD_GID = "150509516";

/**
 * The CAF Record tab for one month, read live for the billing page's "Sheet vs bill" panel: each
 * child's listed nights, the child found through the House Sheet's matched names. Compare only --
 * nothing is stored. Answers only to someone holding the CAF billing power.
 */
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ ok: false, error: "Give a month as YYYY-MM." }, { status: 400 });

  const session = await createClient();
  const { data: userData } = await session.auth.getUser();
  if (!userData.user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data: allowed } = await session.schema("shared").rpc("has_power", { p_power: "caf_billing" });
  if (allowed !== true) return NextResponse.json({ ok: false, error: "The CAF billing power is needed." }, { status: 403 });

  let rows: string[][];
  try {
    const res = await fetch(houseSheetCsvUrl(CAF_RECORD_GID, PROGRAMS_SHEET_ID), { cache: "no-store", redirect: "follow", headers: { accept: "text/csv" } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/csv")) throw new Error(`Google returned ${res.status} for the CAF Record tab — is the LAF Programs sheet still shared as "anyone with the link"?`);
    rows = parseCsv(await res.text(), true);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }

  const lines = cafRecordLines(rows, Number(month.slice(0, 4)))[month] ?? [];
  const keys = [...new Set(lines.map((l) => l.nameKey))];
  const admin = createAdminClient();
  const { data: people, error } = keys.length
    ? await admin.schema("ops").from("house_sheet_people").select("name_key, matched_patient_id").in("name_key", keys).in("match_status", ["auto_matched", "confirmed", "encoded"]).not("matched_patient_id", "is", null)
    : { data: [], error: null };
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const patientOf = new Map((people ?? []).map((p) => [p.name_key as string, p.matched_patient_id as string]));

  // Names never leave the server: a line is a patient id or "unmatched".
  return NextResponse.json({
    ok: true,
    month,
    lines: lines.map((l) => ({ patientId: patientOf.get(l.nameKey) ?? null, dates: l.dates })),
  });
}
