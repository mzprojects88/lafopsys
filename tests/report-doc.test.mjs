// The branded report document (Nov 2026): letterhead on page 1, a footer with the page count on
// every page, tables that flow onto new pages, and the AI box only when the text is there.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildReportPdf, layoutReportDoc } from "../lib/pdf/report-doc.ts";
import { sanitizeAnalysisInput, buildAnalysisPrompt, validateAnalysis } from "../lib/ai/report-analysis.ts";

const branding = { header: "SEC 0000 - BIR TIN 000", accreditation: "DSWD Accreditation No. X-1", orgAddress: "Manila", generatedAt: "5 Nov 2026, 3:12 PM", generatedBy: "Sample Staff, Office Admin" };

const spec = {
  title: "Operations Report",
  period: "Oct 2026",
  previousPeriod: "Sep 2026",
  filters: ["Priority A"],
  analysis: "Overall things moved.",
  sections: [
    { heading: "Housing", description: "People-nights.", kpis: [{ label: "Bed nights", value: "120", previous: "100", change: "+20%" }], chart: { kind: "bar", labels: ["W1", "W2"], series: [{ label: "Nights", values: [60, 60] }] }, analysis: "Housing rose." },
    { heading: "Meals", table: { columns: ["Day", "B", "L", "D"], rows: Array.from({ length: 90 }, (_, i) => [`Day ${i + 1}`, i, i * 2, i * 3]), totals: ["Total", 1, 2, 3] } },
    { heading: "Rank", chart: { kind: "rank", labels: ["A", "B"], series: [{ label: "n", values: [5, 3] }] } },
  ],
};

describe("layoutReportDoc", () => {
  it("flows a long table over several pages and numbers every page", () => {
    const pages = layoutReportDoc(spec, branding);
    assert.ok(pages.length >= 3, `expected 3+ pages, got ${pages.length}`);
    const text = (p) => p.ops.join("\n");
    assert.match(text(pages[0]), /Do Q/, "page 1 draws the logo");
    assert.match(text(pages[0]), /Operations Report/);
    assert.match(text(pages[0]), /review before sharing/);
    pages.forEach((p, i) => {
      assert.match(text(p), new RegExp(`Page ${i + 1} of ${pages.length}`));
      assert.match(text(p), /Generated 5 Nov 2026, 3:12 PM/);
    });
    assert.match(text(pages[1]), /Operations Report - Oct 2026/, "later pages carry the running header");
  });
  it("leaves the AI box out when there is no analysis, and writes a valid PDF", () => {
    const quiet = { ...spec, analysis: undefined, sections: spec.sections.map((s) => ({ ...s, analysis: undefined })) };
    const pages = layoutReportDoc(quiet, branding);
    assert.doesNotMatch(pages[0].ops.join("\n"), /review before sharing/);
    const pdf = buildReportPdf(quiet, branding);
    assert.equal(pdf.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.match(pdf.toString("latin1"), /%%EOF\n$/);
  });
});

describe("report analysis helpers", () => {
  it("keeps only labels and figures, and reads the model's answer back", () => {
    const input = sanitizeAnalysisInput({ title: "T", period: "Oct 2026", previousPeriod: "Sep 2026", sections: [{ heading: "Housing", kpis: [{ label: "Nights", value: 10, previous: 8 }, { label: "x", value: { nested: true } }], columns: ["a"], rows: [[1], "bad"] }, { nope: 1 }] });
    assert.deepEqual(input, { title: "T", period: "Oct 2026", previousPeriod: "Sep 2026", sections: [{ heading: "Housing", description: undefined, kpis: [{ label: "Nights", value: 10, previous: 8 }], columns: ["a"], rows: [[1]] }] });
    assert.match(buildAnalysisPrompt(input), /Nights: 10 \(previous: 8\)/);
    assert.deepEqual(validateAnalysis({ overall: " All good. ", sections: [{ heading: "Housing", text: "Up." }, { heading: "Other", text: "x" }] }, ["Housing"]), { overall: "All good.", sections: { Housing: "Up." } });
    assert.equal(validateAnalysis({ overall: "", sections: [] }, []), null);
  });
});
