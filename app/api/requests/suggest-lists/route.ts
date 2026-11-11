import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited } from "@/lib/utils/rate-limit";
import { openaiConfigured } from "@/lib/ai/env";
import { suggestPaymentLists } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Financial Settings › "Suggest with AI" for paying a person (0135): recipient categories and purposes, from LAF's
 * programs, its chart and how often each account was used. Read as the caller (who must set up Finance); only
 * words and counts go to the model. Suggestions whose account isn't a usable expense account are dropped.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  const { data: allowed } = await supabase.schema("shared").rpc("has_power", { p_power: "finance_setup" });
  if (allowed !== true) return NextResponse.json({ ok: false, error: "Only whoever sets up Finance can ask for suggestions." }, { status: 403 });
  if (isRateLimited(`payment-lists:${userData.user.id}`, 5, 60_000)) return NextResponse.json({ ok: false, error: "Too many suggestions. Try again in a minute." }, { status: 429 });
  if (!openaiConfigured()) return NextResponse.json({ ok: false, error: "AI suggestions are not set up (OPENAI_API_KEY)." }, { status: 503 });

  const ops = () => supabase.schema("ops");
  try {
    const reads = await Promise.all([
      ops().from("programs").select("name"),
      ops().from("coa_accounts").select("code, name, description, is_header, active").like("code", "5%"),
      ops().from("recipient_categories").select("name"),
      ops().from("expense_types").select("label").eq("for_person", true),
      // Counts per account in one query (ops.voucher_line_counts, 0135): all vouchers, nothing but numbers.
      ops().rpc("voucher_line_counts"),
    ]);
    const failed = reads.find((r) => r.error);
    if (failed) return NextResponse.json({ ok: false, error: failed.error!.message }, { status: 500 });
    const [{ data: programs }, { data: accounts }, { data: categories }, { data: types }, { data: counts }] = reads;
    const usable = ((accounts ?? []) as { code: string | null; name: string; description: string | null; is_header: boolean; active: boolean }[]).filter((a) => a.code && !a.is_header && a.active);
    const s = await suggestPaymentLists({
      programs: ((programs ?? []) as { name: string }[]).map((p) => p.name),
      accounts: usable.map((a) => ({ code: a.code as string, name: a.name, description: a.description ?? null })),
      categories: ((categories ?? []) as { name: string }[]).map((c) => c.name),
      purposes: [...new Set(((types ?? []) as { label: string }[]).map((t) => t.label))],
      linesByAccount: ((counts ?? []) as { code: string; lines: number }[]).map((r) => ({ code: r.code, lines: r.lines })),
    });
    const known = new Set(usable.map((a) => a.code as string));
    return NextResponse.json({ ok: true, categories: s.categories, purposes: s.purposes.filter((p) => known.has(p.accountCode)) });
  } catch {
    return NextResponse.json({ ok: false, error: "The AI couldn't answer this time; try again." }, { status: 502 });
  }
}
