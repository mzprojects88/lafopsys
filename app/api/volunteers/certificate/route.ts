import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildVolunteerCert } from "@/lib/pdf/volunteer-cert";
import { nameFormat, titleFor } from "@/lib/utils/staff-name";
import { todayIso } from "@/lib/utils/date";

const UUID = /^[0-9a-f-]{36}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A volunteer's service certificate (0116) for a period, as a PDF. For Staff editors (the Super
 * Admin) and Runs HR (the Office Admin). Counts toward the volunteer's certificates_issued.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const [{ data: staffEdit }, { data: runsHr }] = await Promise.all([
    supabase.schema("shared").rpc("module_editable", { p_module: "staff" }),
    supabase.schema("shared").rpc("has_power", { p_power: "runs_hr" }),
  ]);
  if (staffEdit !== true && runsHr !== true) return NextResponse.json({ error: "Only the Super Admin or the Office Admin prints certificates." }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { volunteerId?: unknown; from?: unknown; to?: unknown } | null;
  const volunteerId = typeof body?.volunteerId === "string" && UUID.test(body.volunteerId) ? body.volunteerId : null;
  const from = typeof body?.from === "string" && DAY.test(body.from) ? body.from : null;
  const to = typeof body?.to === "string" && DAY.test(body.to) ? body.to : null;
  if (!volunteerId || !from || !to || from > to) return NextResponse.json({ error: "Choose a volunteer and a period." }, { status: 400 });

  const admin = createAdminClient();
  const [{ data: volunteer }, { data: hours }, { data: settings }] = await Promise.all([
    admin.schema("ops").from("volunteers").select("first_name, last_name, certificates_issued").eq("id", volunteerId).maybeSingle(),
    admin.schema("ops").from("volunteer_hours").select("date, hours, activity").eq("volunteer_id", volunteerId).gte("date", from).lte("date", to),
    admin.schema("shared").from("app_settings").select("report_header, certificate_signatory_id, document_names").eq("id", true).maybeSingle(),
  ]);
  if (!volunteer) return NextResponse.json({ error: "Volunteer not found" }, { status: 404 });
  if (!hours?.length) return NextResponse.json({ error: "No hours are logged in that period." }, { status: 422 });

  const byActivity = new Map<string, number>();
  for (const h of hours) byActivity.set(h.activity, (byActivity.get(h.activity) ?? 0) + Number(h.hours));
  const signatoryId = settings?.certificate_signatory_id ?? null;
  const { data: signatory } = signatoryId ? await admin.schema("shared").from("staff").select("first_name, last_name, position").eq("id", signatoryId).maybeSingle() : { data: null };
  const name = `${volunteer.first_name} ${volunteer.last_name}`.trim();

  const pdf = buildVolunteerCert({
    volunteerName: name,
    from,
    to,
    totalHours: [...byActivity.values()].reduce((s, h) => s + h, 0),
    sessions: hours.length,
    byActivity: [...byActivity.entries()].sort((a, b) => b[1] - a[1]).map(([activity, h]) => ({ activity, hours: h })),
    issuedOn: todayIso(),
    header: settings?.report_header || undefined,
    signatoryName: signatory ? `${signatory.first_name} ${signatory.last_name}` : undefined,
    signatoryPosition: titleFor(nameFormat(settings?.document_names, "donee_cert"), signatory?.position) ?? undefined,
  });
  await admin.schema("ops").from("volunteers").update({ certificates_issued: (volunteer.certificates_issued ?? 0) + 1 }).eq("id", volunteerId);

  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Volunteer certificate - ${name.replace(/[^A-Za-z0-9 .-]/g, "")}.pdf"`, "Cache-Control": "no-store" },
  });
}
