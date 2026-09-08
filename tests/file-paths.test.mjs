// Bucket layout: folders mirror the main menu; keys are safe for B2 and never collide.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contentTypeFor, folderFor, formatBytes, objectKeyFor, opensInline, periodFolder, sanitiseSegment } from "../lib/utils/file-paths.ts";

describe("sanitiseSegment", () => {
  it("keeps Filipino names, folds slashes, strips the characters B2 and Windows choke on", () => {
    assert.equal(sanitiseSegment("Peña, Niño"), "Peña, Niño");
    assert.equal(sanitiseSegment("HDMF / Pag-IBIG"), "HDMF - Pag-IBIG");
    assert.equal(sanitiseSegment('  a:b*c?d"e<f>g|h{i}j^k%l`m]n[o~p#q  '), "abcdefghijklmnopq");
    assert.equal(sanitiseSegment("..hidden"), "hidden");
    assert.equal(sanitiseSegment("   "), "untitled");
    assert.equal(sanitiseSegment("x".repeat(200)).length, 80);
  });
});

describe("folders by main menu", () => {
  it("HR 201 files by employee", () => {
    assert.equal(folderFor({ kind: "employee", employeeCode: "EMP-3005", firstName: "Juan", lastName: "Dela Cruz" }), "HR/201 Files/Dela Cruz, Juan (EMP-3005)");
  });
  it("compliance by agency, year and month / quarter / annual", () => {
    assert.equal(folderFor({ kind: "compliance_item", agency: "BIR", periodKey: "2026-08" }), "Compliances/BIR/2026/08 August");
    assert.equal(folderFor({ kind: "compliance_item", agency: "BIR", periodKey: "2026-Q3" }), "Compliances/BIR/2026/Q3");
    assert.equal(folderFor({ kind: "compliance_item", agency: "SEC", periodKey: "2026" }), "Compliances/SEC/2026/Annual");
    assert.equal(folderFor({ kind: "compliance_item", agency: "HDMF / Pag-IBIG", periodKey: "2026-12" }), "Compliances/HDMF - Pag-IBIG/2026/12 December");
    assert.equal(periodFolder("weird"), "weird");
  });
  it("patients, donors, bank statements, reports", () => {
    assert.equal(folderFor({ kind: "patient", patientNumber: "PT-0012", firstName: "Ana", lastName: "Santos" }), "Patients/Santos, Ana (PT-0012)");
    assert.equal(folderFor({ kind: "donor", name: "Manny Chan" }), "Donors/Manny Chan");
    assert.equal(folderFor({ kind: "bank_statement_import", coversTo: "2026-08-31", createdAt: "2026-09-02T01:00:00Z" }), "Financial/Bank Statements/2026/08 August");
    assert.equal(folderFor({ kind: "bank_statement_import", coversTo: null, createdAt: "2026-09-02T01:00:00Z" }), "Financial/Bank Statements/2026/09 September");
    assert.equal(folderFor({ kind: "general", category: "Board packs" }), "Reports/Board packs");
  });
});

describe("objectKeyFor", () => {
  it("prefixes the row id so same-named uploads never collide, and stays under 900 bytes", () => {
    const k = objectKeyFor("HR/201 Files/Dela Cruz, Juan (EMP-3005)", "0f6a1b2c-3d4e-4f50-8a9b-0c1d2e3f4a5b", "Contract 2026.pdf");
    assert.equal(k, "HR/201 Files/Dela Cruz, Juan (EMP-3005)/0f6a1b2c-Contract 2026.pdf");
    const long = objectKeyFor("Reports/x", "abcdefgh-1", "ñ".repeat(600) + ".pdf");
    assert.ok(Buffer.byteLength(long, "utf8") <= 900);
  });
});

describe("accepted types", () => {
  it("decides by extension, not by what the browser guessed", () => {
    assert.equal(contentTypeFor("Payslip.PDF"), "application/pdf");
    assert.equal(contentTypeFor("scan.HEIC"), "image/heic");
    assert.equal(contentTypeFor("statement.csv"), "text/csv");
    assert.equal(contentTypeFor("virus.exe"), null);
    assert.equal(contentTypeFor("noextension"), null);
    assert.equal(opensInline("application/pdf"), true);
    assert.equal(opensInline("image/png"), true);
    assert.equal(opensInline("text/csv"), false);
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  });
});
