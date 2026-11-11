import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited } from "@/lib/utils/rate-limit";
import { openaiConfigured } from "@/lib/ai/env";
import { suggestPaymentLists } from "@/lib/ai/openai";
import { fetchAll } from "@/lib/supabase/fetch-all";

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
  const [{ data: programs }, { data: accounts }, { data: categories }, { data: types }, lines] = await Promise.all([
    ops().from("programs").select("name"),
    ops().from("coa_accounts").select("id, code, name, description, is_header, active").like("code", "5%"),
    ops().from("recipient_categories").select("name"),
    ops().from("expense_types").select("label").eq("for_person", true),
    fetchAll<{ account_id: string | null }>((from, to) => ops().from("voucher_lines").select("account_id").order("id").range(from, to)),
  ]);
  const usable = (accounts ?? []).filter((a) => a.code && !a.is_header && a.active);
  const codeOf = new Map(usable.map((a) => [a.id as string, a.code as string]));
  const counts = new Map<string, number>();
  for (const l of lines) {
    const code = l.account_id ? codeOf.get(l.account_id) : undefined;
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  try {
    const s = await suggestPaymentLists({
      programs: (programs ?? []).map((p) => p.name as string),
      accounts: usable.map((a) => ({ code: a.code as string, name: a.name as string, description: (a.description as string | null) ?? null })),
      categories: (categories ?? []).map((c) => c.name as string),
      purposes: [...new Set((types ?? []).map((t) => t.label as string))],
      linesByAccount: [...counts].map(([code, n]) => ({ code, lines: n })),
    });
    const known = new Set(usable.map((a) => a.code as string));
    return NextResponse.json({ ok: true, categories: s.categories, purposes: s.purposes.filter((p) => known.has(p.accountCode)) });
  } catch {
    return NextResponse.json({ ok: false, error: "The AI couldn't answer this time; try again." }, { status: 502 });
  }
}
