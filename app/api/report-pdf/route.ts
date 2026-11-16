import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accreditationLine } from "@/lib/pdf/accreditation";
import { buildReportPdf } from "@/lib/pdf/report-doc";
import { cleanSpec } from "@/lib/pdf/clean-spec";
import { signatureImages } from "@/lib/signatures/server";

/**
 * Any report as a branded PDF (Nov 2026). The page posts the ReportSpec it shows on screen; this
 * route checks the person is signed in, adds the letterhead details from Settings and the
 * "prepared by" line, and lays it out. Nothing in the spec reaches the database.
 */
const MAX_BYTES = 1_000_000;

/** "5 Nov 2026, 3:12 PM" in Manila. */
function manilaNow(): string {
  return new Date().toLocaleString("en-GB", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).replace(" am", " AM").replace(" pm", " PM");
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "The report is too large to print" }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const spec = cleanSpec(raw);
  if (!spec) return NextResponse.json({ error: "Nothing to print" }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: settings }, { data: staff }] = await Promise.all([
    admin.schema("shared").from("app_settings").select("report_header, org_address, dswd_label, dswd_number").eq("id", true).maybeSingle(),
    admin.schema("shared").from("staff").select("first_name, last_name, position").eq("id", userData.user.id).maybeSingle(),
  ]);
  const who = staff ? `${staff.first_name} ${staff.last_name}${staff.position ? `, ${staff.position}` : ""}` : "LAF staff";
  // The preparer's own signature, if they allowed it on reports (0153).
  const sigs = await signatureImages("report", [userData.user.id], `${spec.title}, ${spec.period}`, userData.user.id);
  const pdf = buildReportPdf(spec, {
    signature: sigs.get(userData.user.id),
    header: settings?.report_header || undefined,
    accreditation: accreditationLine(settings),
    orgAddress: settings?.org_address || undefined,
    generatedAt: manilaNow(),
    generatedBy: who,
  });
  const name = `LAF-${spec.title}-${spec.period}.pdf`.replace(/[^A-Za-z0-9.-]+/g, "-");
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
