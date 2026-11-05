import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openaiApiKey, openaiConfigured } from "@/lib/ai/env";
import { askMenuModel } from "@/lib/ai/menu-week";
import { ANALYSIS_SCHEMA, buildAnalysisPrompt, sanitizeAnalysisInput, validateAnalysis } from "@/lib/ai/report-analysis";

/**
 * The AI's comparative analysis for a report (Nov 2026): the page posts the figures it shows for
 * this range and the previous one (labels and numbers only), the model answers in a fixed JSON
 * shape, and the page shows it labelled "AI-generated". Signed-in staff only; nothing is stored.
 */
const MAX_BYTES = 200_000;

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!openaiConfigured()) return NextResponse.json({ error: "The AI analysis is not set up on this server (OPENAI_API_KEY)." }, { status: 503 });

  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Too many figures for one analysis" }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const input = sanitizeAnalysisInput(raw);
  if (!input) return NextResponse.json({ error: "Nothing to analyse" }, { status: 400 });

  const answer = await askMenuModel(openaiApiKey(), buildAnalysisPrompt(input), "report_analysis", ANALYSIS_SCHEMA, 90_000);
  if (!answer.ok) return NextResponse.json({ error: answer.error.replace("suggestion", "analysis") }, { status: answer.status });
  const analysis = validateAnalysis(answer.data, input.sections.map((s) => s.heading));
  if (!analysis) return NextResponse.json({ error: "The analysis came back in an unexpected shape. Try again." }, { status: 502 });
  return NextResponse.json(analysis);
}
