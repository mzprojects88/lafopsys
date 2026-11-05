/**
 * The AI's comparative analysis of a report (Nov 2026): this range against the
 * previous one, written from the figures a page already shows. Only figures and
 * their labels are sent -- never a child's, carer's, donor's or staff member's
 * name -- and the text is labelled "AI-generated" wherever it is shown.
 *
 * No project imports, so it loads under `node --test`.
 */

export interface AnalysisKpi {
  label: string;
  value: string | number;
  previous?: string | number;
}

export interface AnalysisSection {
  heading: string;
  description?: string;
  kpis?: AnalysisKpi[];
  columns?: string[];
  rows?: (string | number)[][];
}

export interface AnalysisInput {
  title: string;
  period: string;
  previousPeriod: string;
  sections: AnalysisSection[];
}

export interface Analysis {
  overall: string;
  sections: Record<string, string>;
}

/** The strict JSON shape the model must answer in. */
export const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: { heading: { type: "string" }, text: { type: "string" } },
        required: ["heading", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["overall", "sections"],
  additionalProperties: false,
} as const;

const LIMITS = { sections: 30, kpis: 24, rows: 120, columns: 16, text: 200 };

/** Keeps the input small and free of anything that is not a figure or a label. */
export function sanitizeAnalysisInput(raw: unknown): AnalysisInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, max = LIMITS.text) => (typeof v === "string" ? v.slice(0, max) : "");
  const cellOk = (v: unknown): v is string | number => typeof v === "number" || typeof v === "string";
  const title = str(r.title, 120);
  const period = str(r.period, 80);
  const previousPeriod = str(r.previousPeriod, 80);
  if (!title || !period || !Array.isArray(r.sections)) return null;
  const sections: AnalysisSection[] = [];
  for (const s of (r.sections as unknown[]).slice(0, LIMITS.sections)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const heading = str(o.heading, 80);
    if (!heading) continue;
    const kpis = Array.isArray(o.kpis)
      ? (o.kpis as unknown[]).slice(0, LIMITS.kpis).flatMap((k) => {
          if (!k || typeof k !== "object") return [];
          const kk = k as Record<string, unknown>;
          if (!str(kk.label, 80) || !cellOk(kk.value)) return [];
          return [{ label: str(kk.label, 80), value: typeof kk.value === "string" ? kk.value.slice(0, 40) : kk.value, previous: cellOk(kk.previous) ? (typeof kk.previous === "string" ? kk.previous.slice(0, 40) : kk.previous) : undefined }];
        })
      : undefined;
    const columns = Array.isArray(o.columns) ? (o.columns as unknown[]).slice(0, LIMITS.columns).map((c) => str(c, 40)) : undefined;
    const rows = Array.isArray(o.rows)
      ? (o.rows as unknown[]).slice(0, LIMITS.rows).flatMap((row) => (Array.isArray(row) ? [row.slice(0, LIMITS.columns).filter(cellOk).map((c) => (typeof c === "string" ? c.slice(0, 60) : c))] : []))
      : undefined;
    sections.push({ heading, description: str(o.description) || undefined, kpis, columns, rows });
  }
  if (!sections.length) return null;
  return { title, period, previousPeriod, sections };
}

export function buildAnalysisPrompt(input: AnalysisInput): string {
  const lines: string[] = [
    "You write the short comparative analysis printed on a report of the Little Ark Foundation, a charity that houses",
    "children with cancer and their carers while they are treated at a hospital in Manila. Readers are the foundation's",
    "staff, board and donors.",
    `Report: ${input.title}. This range: ${input.period}. Previous range: ${input.previousPeriod}.`,
    "Rules: plain English, no jargon, no praise. Compare this range with the previous range and say what changed, with the",
    "numbers. Name the three biggest moves overall. Where a figure is zero or missing, say the data may not have been",
    "recorded rather than that nothing happened. Never invent a cause; you may say what is worth checking. Never mention",
    "a person by name. Times in 12-hour form. 'overall' is at most 120 words. Each section text is at most 90 words and",
    "answers only from that section's figures; use the exact section headings given. Write 'No figures for this range'",
    "when a section has nothing to compare.",
    "",
    "FIGURES",
  ];
  for (const s of input.sections) {
    lines.push(`## ${s.heading}`);
    if (s.description) lines.push(s.description);
    for (const k of s.kpis ?? []) lines.push(`- ${k.label}: ${k.value}${k.previous !== undefined ? ` (previous: ${k.previous})` : ""}`);
    if (s.columns?.length && s.rows?.length) {
      lines.push(`| ${s.columns.join(" | ")} |`);
      for (const r of s.rows) lines.push(`| ${r.join(" | ")} |`);
    }
  }
  return lines.join("\n");
}

/** The model's answer as the shape the pages use, or null when it is not usable. */
export function validateAnalysis(raw: unknown, headings: string[]): Analysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { overall?: unknown; sections?: unknown };
  if (typeof r.overall !== "string" || !r.overall.trim() || !Array.isArray(r.sections)) return null;
  const wanted = new Set(headings);
  const sections: Record<string, string> = {};
  for (const s of r.sections as unknown[]) {
    const o = s as { heading?: unknown; text?: unknown };
    if (typeof o?.heading === "string" && typeof o.text === "string" && wanted.has(o.heading) && o.text.trim()) sections[o.heading] = o.text.trim();
  }
  return { overall: r.overall.trim(), sections };
}
