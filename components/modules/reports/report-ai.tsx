"use client";

import * as React from "react";
import { FileDown, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { Analysis, AnalysisInput } from "@/lib/ai/report-analysis";
import type { ReportSpec } from "@/lib/pdf/report-doc";
import { downloadPdf } from "@/lib/utils/download-pdf";

/**
 * What every report page shares (Nov 2026): the "Include AI analysis" switch,
 * the AI analysis itself (fetched on demand, never stored) and the Download PDF
 * button that prints the spec the page builds, with or without the analysis.
 */

const INCLUDE_KEY = "laf.report.ai";

export function useReportAnalysis() {
  const [analysis, setAnalysis] = React.useState<Analysis | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [include, setIncludeState] = React.useState(true);
  React.useEffect(() => {
    try {
      const v = localStorage.getItem(INCLUDE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads this browser's remembered choice once
      if (v === "0") setIncludeState(false);
    } catch {
      /* private window: default on */
    }
  }, []);
  const setInclude = React.useCallback((v: boolean) => {
    setIncludeState(v);
    try {
      localStorage.setItem(INCLUDE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);
  /** Asks for the analysis; returns it (or null) so a download can wait for it. */
  const run = React.useCallback(async (input: AnalysisInput): Promise<Analysis | null> => {
    setLoading(true);
    try {
      const res = await fetch("/api/report-analysis", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const j = (await res.json().catch(() => null)) as (Analysis & { error?: string }) | null;
      if (!res.ok || !j || j.error) {
        toast.error(j?.error ?? "The analysis failed. Try again.");
        return null;
      }
      setAnalysis(j);
      return j;
    } finally {
      setLoading(false);
    }
  }, []);
  const clear = React.useCallback(() => setAnalysis(null), []);
  return { analysis, loading, include, setInclude, run, clear };
}

/** The spec with the analysis folded in (or stripped, when the switch is off). */
export function withAnalysis(spec: ReportSpec, analysis: Analysis | null, include: boolean): ReportSpec {
  if (!include || !analysis) return { ...spec, analysis: undefined, sections: spec.sections.map((s) => ({ ...s, analysis: undefined })) };
  return { ...spec, analysis: analysis.overall, sections: spec.sections.map((s) => ({ ...s, analysis: analysis.sections[s.heading] })) };
}

export function ReportToolbar({
  ai,
  buildSpec,
  buildInput,
  filename,
  className,
}: {
  ai: ReturnType<typeof useReportAnalysis>;
  buildSpec: () => ReportSpec;
  buildInput: () => AnalysisInput;
  filename: string;
  className?: string;
}) {
  const [downloading, setDownloading] = React.useState(false);
  async function download() {
    setDownloading(true);
    try {
      let a = ai.analysis;
      if (ai.include && !a) a = await ai.run(buildInput());
      const r = await downloadPdf("/api/report-pdf", withAnalysis(buildSpec(), a, ai.include) as unknown as Record<string, unknown>, filename);
      if (!r.ok) toast.error(r.error);
    } finally {
      setDownloading(false);
    }
  }
  const id = React.useId();
  return (
    <div className={className ?? "flex flex-wrap items-center gap-3 print:hidden"}>
      <span className="flex items-center gap-2">
        <Switch id={id} checked={ai.include} onCheckedChange={ai.setInclude} aria-label="Include AI analysis" />
        <Label htmlFor={id} className="text-theme-sm">
          Include AI analysis
        </Label>
      </span>
      <Button type="button" variant="outline" disabled={ai.loading} onClick={() => void ai.run(buildInput())}>
        {ai.loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {ai.analysis ? "Regenerate analysis" : "Analyse"}
      </Button>
      <Button type="button" disabled={downloading || ai.loading} onClick={() => void download()}>
        {downloading ? <Loader2 className="animate-spin" /> : <FileDown />}
        Download PDF
      </Button>
    </div>
  );
}

/** One analysis paragraph as the pages show it: tinted, labelled, collapsible. */
export function AiAnalysisPanel({ text, compact = false }: { text?: string | null; compact?: boolean }) {
  const [open, setOpen] = React.useState(true);
  if (!text) return null;
  return (
    <div className={compact ? "mt-2 rounded-xl bg-blue-50 px-3 py-2 dark:bg-blue-950/30" : "rounded-2xl bg-blue-50 px-4 py-3 dark:bg-blue-950/30"}>
      <button type="button" className="flex w-full items-center justify-between text-left text-theme-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>AI-generated analysis · review before sharing</span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open ? <p className="mt-1 whitespace-pre-line text-theme-sm text-foreground">{text}</p> : null}
    </div>
  );
}
