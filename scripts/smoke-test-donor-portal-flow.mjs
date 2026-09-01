// Regression smoke test for the VIP Donors Portal (supabase/migrations
// 0021-0024). Two phases, because the service-role client bypasses RLS
// entirely and so can't prove isolation on its own:
//
//   1. Setup (service-role client): create an eligible donor + active
//      pledge + portal account, an unrelated second donor as a "someone
//      else's data" probe, and an active campaign.
//   2. RLS assertions (a second client, actually signed in as the donor via
//      signInWithPassword) -- this is the only client that exercises RLS.
//
// Usage: node --env-file=.env.local scripts/smoke-test-donor-portal-flow.mjs

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(label, error) {
  console.error(`[fail] ${label}:`, error?.message ?? error);
  process.exit(1);
}

async function main() {
  const stamp = Date.now();
  const donorAId = randomUUID();
  const donorBId = randomUUID();
  const donorAEmail = `smoke-test-donor-a-${stamp}@example.com`;
  const donorAPassword = "Sm0ke-Test-Password!";
  let donorAAuthUserId;
  let campaignId;
  let pledgeId;
  let ownCommitmentId;

  // --- Setup (service-role) ---

  const { error: donorAError } = await admin.schema("ops").from("donors").insert({
    id: donorAId,
    source_id: `smoke-test-donor-a-${stamp}`,
    name: "Smoke Test VIP Donor",
    type: "individual",
    email: donorAEmail,
    tax_jurisdiction: "PH",
    first_gift_date: "2026-01-01",
    last_gift_date: "2026-06-01",
    lifetime_value: 1500,
    gift_count: 3,
  });
  if (donorAError) fail("donor A insert", donorAError);

  const { error: donorBError } = await admin.schema("ops").from("donors").insert({
    id: donorBId,
    source_id: `smoke-test-donor-b-${stamp}`,
    name: "Smoke Test Other Donor",
    type: "individual",
    tax_jurisdiction: "PH",
    first_gift_date: "2026-01-01",
    last_gift_date: "2026-01-01",
    lifetime_value: 500,
    gift_count: 1,
  });
  if (donorBError) fail("donor B insert", donorBError);
  console.log("[ok] two donors created (A: eligible, B: unrelated probe)");

  pledgeId = randomUUID();
  const { error: pledgeError } = await admin.schema("ops").from("donor_pledges").insert({
    id: pledgeId,
    donor_id: donorAId,
    kind: "cash",
    frequency: "monthly",
    amount: 500,
    currency: "PHP",
    status: "active",
  });
  if (pledgeError) fail("pledge insert", pledgeError);
  console.log("[ok] active pledge recorded for donor A");

  const { data: created, error: createUserError } = await admin.auth.admin.createUser({
    email: donorAEmail,
    password: donorAPassword,
    email_confirm: true,
    app_metadata: { portal: "donor" },
  });
  if (createUserError) fail("auth user create", createUserError);
  donorAAuthUserId = created.user.id;

  const { error: accountError } = await admin.schema("shared").from("donor_accounts").insert({
    id: donorAAuthUserId,
    donor_id: donorAId,
    email: donorAEmail,
    must_change_password: true,
    status: "active",
  });
  if (accountError) fail("donor_accounts insert", accountError);
  console.log("[ok] portal account provisioned for donor A");

  campaignId = randomUUID();
  const { error: campaignError } = await admin.schema("ops").from("campaigns").insert({
    id: campaignId,
    name: "Smoke Test Campaign",
    target_amount: 10000,
    raised_amount: 0,
    start_date: "2026-01-01",
  });
  if (campaignError) fail("campaign insert", campaignError);
  console.log("[ok] active campaign created");

  // --- RLS assertions (signed in as donor A) ---

  const donorClient = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { error: signInError } = await donorClient.auth.signInWithPassword({ email: donorAEmail, password: donorAPassword });
  if (signInError) fail("donor sign-in", signInError);
  console.log("[ok] signed in as donor A");

  const { data: ownDonors, error: ownDonorsError } = await donorClient.schema("ops").from("donors").select("id");
  if (ownDonorsError) fail("donor A ops.donors select", ownDonorsError);
  if (ownDonors.length !== 1 || ownDonors[0].id !== donorAId) fail("donor A ops.donors select", `expected exactly [donorA], got ${JSON.stringify(ownDonors)}`);
  console.log("[ok] ops.donors returns exactly the donor's own row");

  const { data: otherDonor } = await donorClient.schema("ops").from("donors").select("id").eq("id", donorBId);
  if (otherDonor?.length) fail("donor A reading donor B", `expected 0 rows, got ${otherDonor.length}`);
  console.log("[ok] donor A cannot read donor B's row");

  const { data: staffRows } = await donorClient.schema("shared").from("staff").select("id");
  if (staffRows?.length) fail("donor A reading shared.staff", `expected 0 rows, got ${staffRows.length}`);
  console.log("[ok] donor A cannot read the staff roster (0022/0023 leak fix holds)");

  const { data: appSettingsRows } = await donorClient.schema("shared").from("app_settings").select("id");
  if (appSettingsRows?.length) fail("donor A reading shared.app_settings", `expected 0 rows, got ${appSettingsRows.length}`);
  console.log("[ok] donor A cannot read shared.app_settings (leak fix holds)");

  const { data: timeEntryRows } = await donorClient.schema("ops").from("time_entries").select("id");
  if (timeEntryRows?.length) fail("donor A reading ops.time_entries", `expected 0 rows, got ${timeEntryRows.length}`);
  console.log("[ok] donor A cannot read an unrelated staff-only ops.* table");

  const { error: forgedCommitmentError } = await donorClient.schema("ops").from("campaign_commitments").insert({
    id: randomUUID(),
    donor_id: donorBId, // someone else's id
    campaign_id: campaignId,
    kind: "cash",
    pledged_amount: 100,
    currency: "PHP",
    status: "pledged",
  });
  if (!forgedCommitmentError) fail("forged commitment insert", "expected RLS rejection, insert succeeded");
  console.log("[ok] donor A cannot insert a commitment under donor B's id");

  ownCommitmentId = randomUUID();
  const { error: ownCommitmentError } = await donorClient.schema("ops").from("campaign_commitments").insert({
    id: ownCommitmentId,
    donor_id: donorAId,
    campaign_id: campaignId,
    kind: "cash",
    pledged_amount: 250,
    currency: "PHP",
    status: "pledged",
  });
  if (ownCommitmentError) fail("own commitment insert", ownCommitmentError);
  console.log("[ok] donor A can insert their own pledged commitment");

  const { error: cancelError } = await donorClient
    .schema("ops")
    .from("campaign_commitments")
    .update({ status: "cancelled" })
    .eq("id", ownCommitmentId);
  if (cancelError) fail("own commitment cancel", cancelError);
  const { data: cancelled } = await donorClient.schema("ops").from("campaign_commitments").select("status").eq("id", ownCommitmentId).single();
  if (cancelled?.status !== "cancelled") fail("own commitment cancel", `expected 'cancelled', got ${cancelled?.status}`);
  console.log("[ok] donor A can withdraw (pledged -> cancelled) their own commitment");

  const { data: mustChangeUpdate } = await donorClient
    .schema("shared")
    .from("donor_accounts")
    .update({ must_change_password: false })
    .eq("id", donorAAuthUserId)
    .select();
  if (mustChangeUpdate?.length) fail("donor account self-update", `expected 0 rows affected (no UPDATE policy), got ${mustChangeUpdate.length}`);
  console.log("[ok] donor A cannot clear must_change_password directly (fix (a) holds — server action required)");

  await donorClient.auth.signOut();

  // --- Cleanup (service-role) ---

  await admin.schema("ops").from("campaign_commitments").delete().eq("id", ownCommitmentId);
  await admin.schema("ops").from("campaigns").delete().eq("id", campaignId);
  await admin.schema("ops").from("donor_pledges").delete().eq("id", pledgeId);
  await admin.schema("shared").from("donor_accounts").delete().eq("id", donorAAuthUserId);
  await admin.auth.admin.deleteUser(donorAAuthUserId);
  const { error: donorADeleteError } = await admin.schema("ops").from("donors").delete().eq("id", donorAId);
  if (donorADeleteError) fail("cleanup (donor A)", donorADeleteError);
  const { error: donorBDeleteError } = await admin.schema("ops").from("donors").delete().eq("id", donorBId);
  if (donorBDeleteError) fail("cleanup (donor B)", donorBDeleteError);

  const { data: leftover } = await admin.schema("ops").from("donors").select("id").in("id", [donorAId, donorBId]);
  if (leftover?.length) fail("cleanup verification", `${leftover.length} donor row(s) remain`);
  console.log("[ok] cleanup verified — no test rows remain");

  console.log("\nSmoke test passed end-to-end.");
}

main();
