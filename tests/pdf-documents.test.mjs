// The cash acknowledgment receipt and the BIR 2322 certificate (0085): laid out on A4, with the right strings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCashAr, layoutCashAr } from "../lib/pdf/cash-ar.ts";
import { buildDoneeCert, layoutDoneeCert } from "../lib/pdf/donee-cert.ts";
import { A4, pageSvg } from "../lib/pdf/writer.ts";

const drawn = (pages) => pages.flatMap((p) => p.ops).flatMap((op) => [...op.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]));
const fits = (pages) => {
  for (const page of pages.map(pageSvg)) {
    const ys = [...page.matchAll(/<text x="[^"]*" y="([^"]*)"/g)].map((m) => Number(m[1])).sort((p, q) => q - p);
    assert.ok(ys[0] < A4.height);
    assert.ok(ys[1] < ys[0] - 10, "everything sits above the page-number footer");
  }
};

const AR = {
  arNumber: "LAF-CSH-2026-0001",
  bookletNumber: "0457",
  date: "2026-10-13",
  donorName: "Sample Donor Corporation",
  amount: 12500.5,
  currency: "PHP",
  paymentMethod: "bank_transfer",
  campaign: "Sample Appeal",
  notes: "October pledge",
  receivedBy: "Sample Admin",
  receivedByPosition: "Logistics & Facilities Support",
  header: "SEC 2021070019208-08 · BIR TIN 601-322-056-00000 · DSWD Licence DSWD-SB-RL-2026-000131",
};

test("the cash AR prints the number, booklet reference, amount in words and figures, payer and signatory", () => {
  const pages = layoutCashAr(AR);
  assert.equal(pages.length, 1);
  const text = drawn(pages);
  assert.ok(text.includes("AR No. LAF-CSH-2026-0001"));
  assert.ok(text.includes("Booklet AR No. 0457"));
  assert.ok(text.some((t) => t.startsWith("Twelve thousand five hundred pesos and 50/100")));
  assert.ok(text.includes("PHP 12,500.50"));
  assert.ok(text.includes("Bank transfer"));
  assert.ok(text.includes("Logistics & Facilities Support"));
  assert.ok(text.includes("Received for Little Ark Foundation, Inc."));
  fits(pages);
  const pdf = buildCashAr(AR);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length < 100_000);
  // Without a booklet number the line is simply absent.
  assert.ok(!drawn(layoutCashAr({ ...AR, bookletNumber: undefined })).some((t) => t.startsWith("Booklet")));
});

const CERT = {
  controlNumber: "DC-2026-0001",
  date: "2026-10-13",
  kind: "cash",
  amount: 12500.5,
  currency: "PHP",
  donorName: "Sample Donor Corporation",
  donorAddress: "12 Sample Street, Sample City",
  donorTin: "123-456-789-000",
  receiptNumber: "LAF-CSH-2026-0001",
  lines: [],
  orgAddress: "Sample Road, Quezon City",
  orgTin: "601-322-056-00000",
  header: AR.header,
  signatoryName: "Sample Admin",
  signatoryPosition: "Executive Director",
};

test("the certificate names both parties and the cash amount", () => {
  const pages = layoutDoneeCert(CERT);
  assert.equal(pages.length, 1);
  const text = drawn(pages);
  assert.ok(text.includes("Control No. DC-2026-0001"));
  assert.ok(text.includes("TIN 123-456-789-000"));
  assert.ok(text.includes("TIN 601-322-056-00000"));
  assert.ok(text.includes("PHP 12,500.50"));
  assert.ok(text.includes("Acknowledged by receipt No. LAF-CSH-2026-0001."));
  assert.ok(text.includes("Executive Director"));
  fits(pages);
  assert.equal(buildDoneeCert(CERT).subarray(0, 5).toString(), "%PDF-");
});

test("an in-kind certificate lists the items and runs onto more pages", () => {
  // 14 rows on the first page, up to 24 on a last page: 36 lines make exactly two pages.
  const lines = Array.from({ length: 36 }, (_, i) => ({ name: `Item ${i + 1}`, quantity: 2, uom: "pc", value: 10 }));
  const pages = layoutDoneeCert({ ...CERT, kind: "in_kind", amount: 360, lines, donorAddress: undefined });
  assert.equal(pages.length, 2);
  const text = drawn(pages);
  assert.ok(text.includes("Item 36"));
  assert.ok(text.includes("Total value"));
  assert.ok(text.includes("PHP 360.00"));
  assert.ok(text.includes("Address not on file"));
  assert.ok(pages[1].ops.join("\n").includes("Page 2 of 2"));
  fits(pages);
});

test("volunteer service certificate (0116): a one-page PDF naming the hours and the period", async () => {
    const { buildVolunteerCert, layoutVolunteerCert } = await import("../lib/pdf/volunteer-cert.ts");
    const data = { volunteerName: "Test Volunteer", from: "2026-01-01", to: "2026-10-27", totalHours: 12.5, sessions: 5, byActivity: [{ activity: "Care Cart", hours: 10 }, { activity: "Events", hours: 2.5 }], issuedOn: "2026-10-27", signatoryName: "Signer", signatoryPosition: "Executive Director" };
    assert.equal(layoutVolunteerCert(data).length, 1);
    const pdf = buildVolunteerCert(data);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const words = drawn(layoutVolunteerCert(data)).join(" ");
    assert.match(words, /12.5 hours/);
    assert.match(words, /Test Volunteer/);
    fits(layoutVolunteerCert(data));
});

test("cash AR carries the DSWD line under the letterhead and in the footer (0119)", async () => {
  const { accreditationLine } = await import("../lib/pdf/accreditation.ts");
  const line = accreditationLine({ dswd_label: "DSWD Accreditation No.", dswd_number: "DSWD-SB-RL-2026-000131" });
  assert.equal(line, "DSWD Accreditation No. DSWD-SB-RL-2026-000131");
  assert.equal(accreditationLine({ dswd_label: "DSWD Accreditation No.", dswd_number: null }), undefined);
  const pages = layoutCashAr({ arNumber: "LAF-CSH-2026-0001", date: "2026-10-27", donorName: "Test donor", amount: 1000, currency: "PHP", header: "SEC 2021070019208-08 · BIR TIN 601-322-056-00000", accreditation: line });
  assert.equal(drawn(pages).filter((t) => t === line).length, 2);
  fits(pages);
});
