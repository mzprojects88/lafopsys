import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRateLimited } from "@/lib/utils/rate-limit";
import { suggestWeek, type Rpc } from "@/lib/ai/menu-week";

export const dynamic = "force-dynamic";
export const maxDuration = 150;

const PLANNERS = ["admin", "inventory_lead", "chef", "social_worker", "nutritionist"];

/** Suggest the week's menu from House Operations (0120 / Inventory 0068): the database checks the role; `preview` returns it without saving. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { weekStart?: unknown; preview?: unknown } | null;
  const weekStart = typeof body?.weekStart === "string" ? body.weekStart : "";
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: allowed } = await supabase.schema("shared").rpc("has_role", { p_roles: PLANNERS });
  if (allowed !== true) return NextResponse.json({ error: "Only the Social Worker, the Nutritionist, the kitchen or the admin plans a menu" }, { status: 403 });
  if (isRateLimited(`menu-suggest:${userData.user.id}`, 6, 60_000)) return NextResponse.json({ error: "Too many suggestions. Try again in a minute." }, { status: 429 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "AI suggestions are not set up (OPENAI_API_KEY)." }, { status: 503 });
  const rpc: Rpc = async (fn, args) => {
    const { data, error } = await supabase.schema("inventory").rpc(fn, args);
    return { data, error };
  };
  const r = await suggestWeek(rpc, apiKey, weekStart, body?.preview !== true);
  return r.ok ? NextResponse.json({ ok: true, ...r.result }) : NextResponse.json({ error: r.error }, { status: r.status });
}
