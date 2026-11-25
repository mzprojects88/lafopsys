import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { arFileName, attachmentHeader, fileNameFromHeader } from "../lib/utils/ar-file-name.ts";

// Made-up donors. The same cases are in LAF Inventory's lib/utils/ar-file-name.test.ts.
describe("donor document file names (25 Nov 2026)", () => {
  it("is <Donor>-<number>.pdf, keeping the donor's own punctuation", () => {
    assert.equal(arFileName("Juan Dela Cruz", "LAF-GIK-2026-0049"), "Juan Dela Cruz-LAF-GIK-2026-0049.pdf");
    assert.equal(arFileName("ABC Trading Corp.", "LAF-GIK-2026-0050"), "ABC Trading Corp.-LAF-GIK-2026-0050.pdf");
  });

  it("drops characters a file name can't hold, cuts a long name on a word, and names no donor Anonymous", () => {
    assert.equal(arFileName("Sample Church / Youth Ministry", "LAF-CSH-2026-0271"), "Sample Church Youth Ministry-LAF-CSH-2026-0271.pdf");
    assert.equal(arFileName("The Very Long Sample Name of a Foundation for Children With Cancer and Their Families", "LAF-GIK-2026-0051"), 
      "The Very Long Sample Name of a Foundation for Children With-LAF-GIK-2026-0051.pdf"
    );
    assert.equal(arFileName(null, "LAF-CSH-2026-0272"), "Anonymous donor-LAF-CSH-2026-0272.pdf");
    assert.equal(arFileName("  ", "0463"), "Anonymous donor-0463.pdf");
  });

  it("an ñ survives the trip: plain letters for old browsers, the full name for the rest", () => {
    const name = arFileName("Peñafrancia Sample Foods, Inc.", "LAF-ASN-2026-0002");
    const header = attachmentHeader(name);
    assert.ok(header.includes('filename="Penafrancia Sample Foods, Inc.-LAF-ASN-2026-0002.pdf"'));
    assert.equal(fileNameFromHeader(header, "x.pdf"), "Peñafrancia Sample Foods, Inc.-LAF-ASN-2026-0002.pdf");
    assert.equal(fileNameFromHeader('attachment; filename="LAF-CSH-2026-0001.pdf"', "x.pdf"), "LAF-CSH-2026-0001.pdf");
    assert.equal(fileNameFromHeader(null, "LAF-GIK-2026-0049.pdf"), "LAF-GIK-2026-0049.pdf");
  });
});
