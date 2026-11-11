import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited } from "@/lib/utils/rate-limit";
import { openaiConfigured } from "@/lib/ai/env";
import { suggestBudget } from "@/lib/ai/openai";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { MEASURES, measureTotal, type Measure } from "@/lib/utils/budgets";
import type { ImpactLine } from "@/lib/utils/program-impact";
import { countedDay, settledAdvances, SPENDING, type VoucherKind, type VoucherStatus } from "@/lib/utils/vouchers";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Budgets › "Suggest from goals" (0137): only for those who read the goals (the CEO and the Super Admin). Read as the
 * caller: the goals and their targets for the year, the last twelve months of voucher spending by program and
 * account, what ArkOS counted, and gifts by month; only those totals go to the model. Suggestions naming an unknown
 * program, measure or account are cleaned of it.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { year?: unknown } | null;
  const year = typeof body?.year === "number" && body.year >= 2020 && body.year <= 2100 ? body.year : null;
  if (!year) return NextResponse.json({ ok: false, error: "Bad year." }, { status: 400 });
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data: allowed } = await supabase.schema("shared").rpc("has_role", { p_roles: ["ceo", "admin"] });
  if (allowed !== true) return NextResponse.json({ ok: false, error: "Only the CEO or the Super Admin asks, as the goals are theirs." }, { status: 403 });
  if (isRateLimited(`budget-suggest:${userData.user.id}`, 4, 60_000)) return NextResponse.json({ ok: false, error: "Too many suggestions. Try again in a minute." }, { status: 429 });
  if (!openaiConfigured()) return NextResponse.json({ ok: false, error: "AI suggestions are not set up (OPENAI_API_KEY)." }, { status: 503 });

  const ops = () => supabase.schema("ops");
  const end = new Date();
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const today = end.toISOString().slice(0, 10);
  try {
    const reads = await Promise.all([
      ops().from("fin_codes").select("id, code, name, tier").eq("tier", "T3").eq("active", true),
      ops().from("coa_accounts").select("id, code").not("code", "is", null),
      ops().from("goals").select("id, title, horizon, start_year, program_id, measure, narrative").eq("status", "active"),
      ops().from("goal_targets").select("goal_id, year, target").eq("year", year),
      ops().from("programs").select("id, name"),
      ops().rpc("program_impact_range", { p_from: start, p_to: today, p_grain: "month" }),
    ]);
    const failed = reads.find((r) => r.error);
    if (failed) return NextResponse.json({ ok: false, error: failed.error!.message }, { status: 500 });
    const [t3, accounts, goals, targets, programs, impact] = reads.map((r) => (r.data ?? []) as Record<string, unknown>[]);
    // Only the last twelve months: the gifts (paged past the 1,000-row cap), the spending vouchers, and then their
    // lines and preparing dates, in parallel batches of ids.
    const [gifts, vouchers] = await Promise.all([
      fetchAll<Record<string, unknown>>((from, to) => ops().from("donations").select("id, date, total_value").gte("date", start).order("id").range(from, to)),
      fetchAll<Record<string, unknown>>((from, to) => ops().from("vouchers").select("id, kind, status, advance_of, submitted_at, created_at").in("status", [...SPENDING]).or(`submitted_at.gte.${start},created_at.gte.${start}`).order("id").range(from, to)),
    ]);
    const ids = vouchers.map((v) => String(v.id));
    const batches = Array.from({ length: Math.ceil(ids.length / 150) }, (_, i) => ids.slice(i * 150, i * 150 + 150));
    const [lines, prepares] = await Promise.all([
      Promise.all(batches.map((b) => fetchAll<Record<string, unknown>>((from, to) => ops().from("voucher_lines").select("id, voucher_id, amount, t3_id, account_id").in("voucher_id", b).order("id").range(from, to)))).then((x) => x.flat()),
      Promise.all(batches.map((b) => fetchAll<Record<string, unknown>>((from, to) => ops().from("voucher_events").select("id, voucher_id, at").eq("action", "prepare").in("voucher_id", b).order("id").range(from, to)))).then((x) => x.flat()),
    ]);
    const preparedOn = new Map(prepares.map((e) => [String(e.voucher_id), String(e.at)]));

    const codeOfT3 = new Map(t3.map((c) => [String(c.id), String(c.code)]));
    const codeOfAccount = new Map(accounts.map((a) => [String(a.id), String(a.code)]));
    // The same rule as the Budgets page: the Manila day Finance prepared it.
    const counted = vouchers.map((v) => ({ id: String(v.id), kind: v.kind as VoucherKind, status: v.status as VoucherStatus, advanceOf: (v.advance_of as string | null) ?? null, submittedAt: (v.submitted_at as string | null) ?? null, createdAt: String(v.created_at) }));
    const settled = settledAdvances(counted);
    const monthOf = new Map(counted.map((v) => [v.id, countedDay(v, preparedOn.get(v.id), settled)?.slice(0, 7)]));
    const spend = new Map<string, number>();
    for (const l of lines) {
      const m = monthOf.get(String(l.voucher_id));
      if (!m || m < start.slice(0, 7)) continue;
      const key = `${m}|${codeOfT3.get(String(l.t3_id)) ?? ""}|${codeOfAccount.get(String(l.account_id)) ?? ""}`;
      spend.set(key, (spend.get(key) ?? 0) + Number(l.amount));
    }
    const rows = impact.map((r) => ({ line: String(r.line) as ImpactLine, bucket: String(r.bucket).slice(0, 10), native: Number(r.native), fromSheet: Number(r.from_sheet) }));
    const buckets = [...new Set(rows.map((r) => r.bucket))];
    const giftMonths = new Map<string, number>();
    for (const g of gifts) giftMonths.set(String(g.date).slice(0, 7), (giftMonths.get(String(g.date).slice(0, 7)) ?? 0) + Number(g.total_value ?? 0));

    const s = await suggestBudget({
      year,
      programs: t3.map((c) => ({ code: String(c.code), name: String(c.name) })),
      measures: (Object.keys(MEASURES) as Measure[]).map((k) => ({ key: k, label: MEASURES[k].label, unit: MEASURES[k].unit })),
      goals: goals.map((g) => ({
        title: String(g.title), horizon: Number(g.horizon), startYear: Number(g.start_year),
        program: g.program_id ? String(programs.find((p) => p.id === g.program_id)?.name ?? "") : null, measure: String(g.measure),
        target: (targets.find((t) => t.goal_id === g.id)?.target as number | undefined) ?? null, narrative: (g.narrative as string | null) ?? null,
      })),
      spendingByMonth: [...spend].map(([k, amount]) => {
        const [month, program, account] = k.split("|");
        return { month, program: program || null, account: account || null, amount: Math.round(amount * 100) / 100 };
      }),
      countedByMonth: buckets.flatMap((b) => (Object.keys(MEASURES) as Measure[]).map((m) => ({ month: b.slice(0, 7), measure: m, quantity: measureTotal(rows, m, b) }))).filter((x) => x.quantity > 0),
      giftsByMonth: [...giftMonths].map(([month, amount]) => ({ month, amount: Math.round(amount * 100) / 100 })),
    });
    const programCodes = new Set(t3.map((c) => String(c.code)));
    const accountCodes = new Set(codeOfAccount.values());
    return NextResponse.json({
      ok: true,
      summary: s.summary,
      items: s.items.map((i) => ({
        ...i,
        program: i.program && programCodes.has(i.program) ? i.program : null,
        measure: i.measure && i.measure in MEASURES ? i.measure : null,
        accountCode: i.accountCode && accountCodes.has(i.accountCode) ? i.accountCode : null,
      })),
    });
  } catch {
    return NextResponse.json({ ok: false, error: "The AI couldn't answer this time; try again." }, { status: 502 });
  }
}
