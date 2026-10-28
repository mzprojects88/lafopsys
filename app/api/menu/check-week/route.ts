import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited } from "@/lib/utils/rate-limit";
import { checkWeek, type Rpc } from "@/lib/ai/menu-week";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PLANNERS = ["admin", "inventory_lead", "chef", "social_worker", "nutritionist"];

/** Check the week's planned meals against the doctors' food instructions (0120 / Inventory 0068). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { weekStart?: unknown } | null;
  const weekStart = typeof body?.weekStart === "string" ? body.weekStart : "";
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: allowed } = await supabase.schema("shared").rpc("has_role", { p_roles: PLANNERS });
  if (allowed !== true) return NextResponse.json({ error: "Only the Social Worker, the Nutritionist, the kitchen or the admin checks a menu" }, { status: 403 });
  if (isRateLimited(`menu-check:${userData.user.id}`, 10, 60_000)) return NextResponse.json({ error: "Too many checks. Try again in a minute." }, { status: 429 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI checks are not set up (OPENAI_API_KEY)." }, { status: 503 });
  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await supabase.schema("inventory").rpc(fn, args);
    return { data, error };
  };
  const r = await checkWeek(rpc, apiKey, weekStart);
  return r.ok ? NextResponse.json({ ok: true, ...r.result }) : NextResponse.json({ error: r.error }, { status: r.status });
}
