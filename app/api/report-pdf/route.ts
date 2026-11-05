import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accreditationLine } from "@/lib/pdf/accreditation";
import { buildReportPdf, type ReportSpec } from "@/lib/pdf/report-doc";

/**
 * Any report as a branded PDF (Nov 2026). The page posts the ReportSpec it shows on screen; this
 * route checks the person is signed in, adds the letterhead details from Settings and the
 * "prepared by" line, and lays it out. Nothing in the spec reaches the database.
 */
const MAX_BYTES = 1_000_000;
const LIMITS = { sections: 40, rows: 2000, text: 4000 };

function cleanSpec(raw: unknown): ReportSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const cell = (v: unknown): string | number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" ? v.slice(0, 120) : "");
  const title = str(r.title, 120);
  const period = str(r.period, 80);
  if (!title || !period || !Array.isArray(r.sections)) return null;
  const sections: ReportSpec["sections"] = [];
  for (const s of (r.sections as unknown[]).slice(0, LIMITS.sections)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const heading = str(o.heading, 120);
    if (!heading) continue;
    const kpis = Array.isArray(o.kpis)
      ? (o.kpis as unknown[]).slice(0, 24).flatMap((k) => {
          const kk = (k ?? {}) as Record<string, unknown>;
          const label = str(kk.label, 80);
          const value = str(kk.value, 40);
          return label && value !== undefined ? [{ label, value, previous: str(kk.previous, 40), change: str(kk.change, 24) }] : [];
        })
      : undefined;
    const t = o.table as Record<string, unknown> | undefined;
    const table =
      t && Array.isArray(t.columns) && Array.isArray(t.rows)
        ? {
            columns: (t.columns as unknown[]).slice(0, 16).map((c) => str(c, 60) ?? ""),
            rows: (t.rows as unknown[]).slice(0, LIMITS.rows).map((row) => (Array.isArray(row) ? row.slice(0, 16).map(cell) : [])),
            totals: Array.isArray(t.totals) ? (t.totals as unknown[]).slice(0, 16).map(cell) : undefined,
          }
        : undefined;
    const c = o.chart as Record<string, unknown> | undefined;
    const chart =
      c && (c.kind === "bar" || c.kind === "stacked" || c.kind === "rank") && Array.isArray(c.labels) && Array.isArray(c.series)
        ? {
            kind: c.kind as "bar" | "stacked" | "rank",
            labels: (c.labels as unknown[]).slice(0, 400).map((l) => str(l, 40) ?? ""),
            series: (c.series as unknown[]).slice(0, 8).flatMap((x) => {
              const xx = (x ?? {}) as Record<string, unknown>;
              const label = str(xx.label, 60);
              return label && Array.isArray(xx.values) ? [{ label, values: (xx.values as unknown[]).slice(0, 400).map((v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0)) }] : [];
            }),
          }
        : undefined;
    sections.push({ heading, description: str(o.description, 600), kpis, table, chart, analysis: str(o.analysis, LIMITS.text) });
  }
  return {
    title,
    subtitle: str(r.subtitle, 200),
    period,
    previousPeriod: str(r.previousPeriod, 80),
    filters: Array.isArray(r.filters) ? (r.filters as unknown[]).slice(0, 20).flatMap((f) => (typeof f === "string" ? [f.slice(0, 120)] : [])) : undefined,
    analysis: str(r.analysis, LIMITS.text),
    sections,
  };
}

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
  const pdf = buildReportPdf(spec, {
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
