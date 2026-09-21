// One-off: removes the referral + patient that scripts/smoke-test-referral-flow.mjs
// left in production on 2026-08-17 (its cleanup deletes the stay and carer but
// not the patient). Refuses unless both rows are exactly the smoke-test ones.
// Usage: node --env-file=.env.local scripts/cleanup-smoke-test-referral.mjs
import { createClient } from "@supabase/supabase-js";

const REFERRAL = "f405c44e-931b-4c68-93b7-f278db993629";
const PATIENT = "d444fed0-9034-4bc1-ab82-173fda42d859";
const ops = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
}).schema("ops");

const { data: ref } = await ops.from("referrals").select("patient_name, admitted_patient_id").eq("id", REFERRAL).maybeSingle();
const { data: pt } = await ops.from("patients").select("first_name, last_name, patient_number").eq("id", PATIENT).maybeSingle();
if (!ref && !pt) {
  console.log("Already gone.");
  process.exit(0);
}
if ((ref && ref.patient_name !== "Smoke Test Patient") || (pt && !pt.patient_number.startsWith("REF-"))) {
  console.error("Rows do not look like the smoke test's -- refusing.", ref, pt);
  process.exit(1);
}
const { count: stays } = await ops.from("stays").select("id", { count: "exact", head: true }).eq("patient_id", PATIENT);
const { count: sheet } = await ops.from("house_sheet_people").select("id", { count: "exact", head: true }).eq("referral_id", REFERRAL);
if (stays || sheet) {
  console.error(`Still referenced (stays: ${stays}, house sheet rows: ${sheet}) -- refusing.`);
  process.exit(1);
}

// Referral first: referrals.admitted_patient_id points at the patient without a cascade.
for (const [table, id] of [["referrals", REFERRAL], ["patients", PATIENT]]) {
  const { error } = await ops.from(table).delete().eq("id", id);
  if (error) {
    console.error(`${table} delete failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`deleted ops.${table} ${id}`);
}
