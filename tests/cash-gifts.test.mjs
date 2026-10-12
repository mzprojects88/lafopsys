// Unit tests for lib/utils/cash-gifts.ts: reading accounting's cash sheets and proposing who each name is.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cashProgress, givingSplit, namesToConfirm, newDonorFrom, paymentMethodFrom, paymentMethodFromMemo, readCashRows } from "../lib/utils/cash-gifts.ts";
import { donorNameKey } from "../lib/utils/donor-details.ts";

const donor = (id, name, type = "individual", giftCount = 0) => ({ id, name, type, taxJurisdiction: "PH", firstGiftDate: "", lastGiftDate: "", lifetimeValue: 0, giftCount });
const line = (donorName, amount = 1000, more = {}) => ({ source: "2026", lineKey: `${donorName}|${amount}`, sheetRow: 2, date: "2026-01-02", donorName, nameKey: donorNameKey(donorName) || "unnamed", kind: "cash", amount, ...more });

describe("reading a cash sheet", () => {
  // The tracker's CASH tab: A date, C donor, H type, I amount, J invoice, L notes.
  const TRACKER = { date: 0, donor: 2, method: 7, amount: 8, invoice: 9, notes: 11 };
  const row = (date, donor, type, amount, invoice = "", notes = "") => [date, "", donor, "0917 000 0000", "x@example.org", "Somewhere", "", type, amount, invoice, "", notes];

  it("reads gifts; never the contact columns", () => {
    const { lines, problems } = readCashRows([row("1/2/2026", "Mario Chavez ", "BANK TRANSFER", "10,000.00", "0328"), row("1/5/2026", "Nina Robles", "CASH", "8,000.00", "0414", "DEPOSITED")], TRACKER);
    assert.deepEqual(problems, []);
    assert.deepEqual(lines[0], { sheet_row: 2, date: "2026-01-02", donor_name: "Mario Chavez", kind: "cash", payment_method: "bank_transfer", amount: 10000, invoice_number: "0328", notes: null });
    assert.deepEqual([lines[1].payment_method, lines[1].notes, lines[1].sheet_row], ["cash", "DEPOSITED", 3]);
    assert.ok(!JSON.stringify(lines).includes("0917") && !JSON.stringify(lines).includes("example.org") && !JSON.stringify(lines).includes("Somewhere"));
  });

  it("a row it can't read is reported, not dropped in silence; blank rows and totals are not rows", () => {
    const { lines, problems } = readCashRows([row("210/2026", "Maria Santos", "GCASH", "5,528.00", "0101"), row("2/30/2026", "Juan Cruz", "CASH", "100.00"), row("3/1/2026", "No Amount", "CASH", ""), row("", "", "", ""), ["Total for Cash Donations", "", "", "", "", "", "", "", "PHP 895,416.11"]], TRACKER);
    assert.equal(lines.length, 0);
    assert.equal(problems.length, 3);
    assert.match(problems[0], /Row 2: the date "210\/2026" can't be read \(Maria Santos, 5,528\.00\)/);
    assert.match(problems[1], /Row 3/);
    assert.match(problems[2], /Row 4: no amount/);
  });

  it("a date outside the sheet's year, or not yet come, is a typing mistake: reported, not read", () => {
    const { lines, problems } = readCashRows([row("1/15/2025", "Sample Systems Co", "BANK TRANSFER", "20,000.00"), row("7/30/3036", "Ana Reyes", "BANK TRANSFER", "10,000.00"), row("12/25/2026", "Early Bird", "CASH", "1.00"), row("10/12/2026", "On Time", "CASH", "1.00")], TRACKER, { firstRow: 2, year: 2026, today: "2026-10-12" });
    assert.deepEqual(lines.map((l) => l.donor_name), ["On Time"]);
    assert.deepEqual(problems, [
      "Row 2: the date 1/15/2025 is not in 2026 (Sample Systems Co, 20,000.00).",
      "Row 3: the date 7/30/3036 is not in 2026 (Ana Reyes, 10,000.00).",
      "Row 4: the date 12/25/2026 has not come yet (Early Bird, 1.00).",
    ]);
  });

  it("no name is Anonymous; payment types", () => {
    assert.equal(readCashRows([row("1/2/2026", "", "INSTAPAY", "18,700.00")], TRACKER).lines[0].donor_name, "Anonymous");
    assert.deepEqual(["CASH", "Check", "BANK TRANSFER", "GCASH", "G-Cash", "INSTAPAY", "PAYMAYA", ""].map((t) => paymentMethodFrom(t)), ["cash", "check", "bank_transfer", "gcash", "gcash", "instapay", "other", null]);
  });

  it("a report's memo: the method only when it names one; sales and tests are not gifts", () => {
    assert.deepEqual(["Cash from Donor", "Cash from Board", "Check from Donor", "Gcash Deposit from Donor", "Cash from Donor, Bank Deposit"].map(paymentMethodFromMemo), [null, null, "check", "gcash", "bank_transfer"]);
    // The 2025 report: A date, E customer, F memo, G amount, H invoice.
    const REPORT = { date: 0, donor: 4, memo: 5, amount: 6, invoice: 7 };
    const r = (date, donor, memo, amount, inv = "") => [date, "Journal Entry", "2024-0248-277", "No", donor, memo, amount, inv];
    const read = readCashRows([r("01/02/2025", "Anonymous", "Cash from Donor", "10,000.00 ", "0071"), r("02/07/2025", "Anonymous", "Cash from Donor - sale of rice donation", "2,250.00"), r("03/17/2025", "Pedro Ramos", "Test Transfer from LAF GCASH", "24.50"), r("12/19/2025", "Anonymous", "Rice Conversion", "18,000.00")], REPORT);
    assert.equal(read.lines.length, 1);
    assert.deepEqual([read.lines[0].date, read.lines[0].amount, read.lines[0].payment_method, read.lines[0].notes, read.lines[0].invoice_number], ["2025-01-02", 10000, null, "Cash from Donor", "0071"]);
    assert.equal(read.leftOut.length, 3);
    assert.deepEqual(read.problems, []);
  });
});

describe("names to confirm", () => {
  const donors = [donor("d1", "Mario Chavez", "individual", 3), donor("d2", "SAMPLE FOOD CORP", "corporate", 14), donor("d3", "SAMPLE FOOD CORP.", "corporate", 1), donor("d4", "Marko Tan"), donor("anon", "Anonymous", "anonymous", 20)];

  it("the same name as one donor is ready and goes to that donor, however it was typed", () => {
    const [n] = namesToConfirm([line("MR. MARIO CHAVEZ"), line("Chavez, Mario", 500)], donors, []);
    assert.deepEqual([n.sheetName, n.gifts, n.total, n.ready, n.proposal], ["Chavez, Mario", 2, 1500, true, { donorId: "d1" }]);
  });

  it("a new name nothing resembles is ready, written the LAF way", () => {
    const [n] = namesToConfirm([line("SAMPLE BUILDERS INC.")], donors, []);
    assert.equal(n.ready, true);
    assert.deepEqual(n.proposal, { name: "Sample Builders Inc.", salutation: null, type: "corporate" });
    const written = (n, hint) => { const d = newDonorFrom(n, hint); return [d.salutation, d.name, d.type, d.typedBy]; };
    assert.deepEqual(written("Carlo/Joy De Jesus"), [null, "Carlo/Joy de Jesus", "individual", "rule"]);
    assert.deepEqual(written("Ramon/ Irma Lee"), [null, "Ramon/Irma Lee", "individual", "rule"]);
    assert.deepEqual(written("Rotary Club of Sample City"), [null, "Rotary Club of Sample City", "foundation", "keyword"]);
    assert.deepEqual(written("Atty. MARIA SANTOS"), ["Atty.", "Maria Santos", "individual", "rule"]);
  });

  it("what was typed on purpose stays (found by the rehearsal on the real sheets)", () => {
    const name = (n, hint) => newDonorFrom(n, hint).name;
    assert.equal(name("OneHope"), "OneHope");
    assert.equal(name("BreadHouse QC"), "BreadHouse QC");
    assert.equal(name("The BELLA'S Award"), "The Bella's Award");
    assert.equal(name("Pedro Ramos(B)"), "Pedro Ramos(B)");
    assert.equal(name("Kat from Acme"), "Kat from Acme");
    assert.equal(name("SAMPLE REALTY AND DEVELOPMENT CORP."), "Sample Realty and Development Corp.");
    assert.equal(name("NATIONAL SHRINE OF OUR LADY OF PEACE SAMPLE CITY"), "National Shrine of Our Lady of Peace Sample City");
    assert.equal(name("mcdonald o'brien"), "McDonald O'Brien");
    assert.equal(name("D'ANGELO SANTOS"), "D'Angelo Santos");
    assert.equal(name("c/o David"), "c/o David");
  });

  it("the AI's hint settles the type when no word in the name does; the rules still write the name", () => {
    const hint = (type, incomplete = false) => ({ nameKey: "x", type, incomplete });
    assert.deepEqual([newDonorFrom("ACME PH").type, newDonorFrom("ACME PH").name], ["individual", "Acme Ph"]);
    const acme = newDonorFrom("ACME PH", hint("corporate"));
    assert.deepEqual([acme.type, acme.name, acme.typedBy], ["corporate", "Acme PH", "ai"]);
    // A clear word outranks the hint ("& Friends" stays a household, whatever the AI says).
    assert.deepEqual([newDonorFrom("Reyes Family & Friends", hint("corporate")).type, newDonorFrom("Reyes Family & Friends", hint("corporate")).typedBy], ["individual", "keyword"]);
    const names = namesToConfirm([line("EAGLES"), line("Ms. Dana"), line("Reimbursement of expense charge to OneHope for the month of August"), line("Maria Santos")], [], [], [{ nameKey: "eagles", type: "foundation", incomplete: false }, { nameKey: "santos maria", type: "individual", incomplete: false }]);
    const by = Object.fromEntries(names.map((n) => [n.sheetName, n]));
    assert.deepEqual([by["EAGLES"].proposal, by["EAGLES"].typedBy, by["EAGLES"].ready], [{ name: "Eagles", salutation: null, type: "foundation" }, "ai", true]);
    assert.deepEqual([by["Ms. Dana"].ready, by["Ms. Dana"].notes.length, by["Ms. Dana"].proposal], [false, 1, { name: "Dana", salutation: "Ms.", type: "individual" }]);
    assert.equal(by["Reimbursement of expense charge to OneHope for the month of August"].ready, false);
    assert.equal(namesToConfirm([line("BreadHouse QC support for LAF- February")], [], [])[0].ready, false);
    assert.equal(newDonorFrom("ABCD", { nameKey: "abcd", type: "corporate", incomplete: false }).name, "ABCD");
    assert.deepEqual([by["Maria Santos"].ready, by["Maria Santos"].notes], [true, []]);
  });

  it("a look-alike is not ready: near a donor, near another new name, or two donors with the name", () => {
    const names = namesToConfirm([line("Marco Tan"), line("Daniel Soriano"), line("Daniel Sorriano"), line("Sample Food Corp")], donors, []);
    const by = Object.fromEntries(names.map((n) => [n.sheetName, n]));
    assert.equal(by["Marco Tan"].ready, false);
    assert.deepEqual(by["Marco Tan"].candidates.map((c) => [c.donor.id, c.same]), [["d4", false]]);
    assert.ok("name" in by["Marco Tan"].proposal); // proposed as new; staff choose the similar donor if it is the same
    assert.deepEqual([by["Daniel Soriano"].ready, by["Daniel Soriano"].lookAlikes], [false, ["Daniel Sorriano"]]);
    assert.equal(by["Sample Food Corp"].ready, false);
    assert.deepEqual(by["Sample Food Corp"].proposal, { donorId: "d2" }); // the one with more gifts
    assert.ok(names.findIndex((n) => !n.ready) === 0);
  });

  it("Anonymous goes to the anonymous donor; decided names don't come back", () => {
    const names = namesToConfirm([line("Anonymous", 478873), line("Mario Chavez")], donors, [{ nameKey: donorNameKey("Mario Chavez"), donorId: "d1" }]);
    assert.equal(names.length, 1);
    assert.deepEqual([names[0].proposal, names[0].ready], [{ donorId: "anon" }, true]);
  });
});

describe("totals", () => {
  it("per sheet: in the donor list, waiting, left out", () => {
    const lines = [line("Mario Chavez", 1000), line("New Person", 250), line("Test Transfer", 25), line("Old Donor", 10, { source: "2024" })];
    const p = cashProgress(lines, [{ nameKey: donorNameKey("Mario Chavez"), donorId: "d1" }, { nameKey: donorNameKey("Test Transfer"), donorId: null }]);
    assert.deepEqual(p["2026"], { posted: { gifts: 1, total: 1000 }, waiting: { gifts: 1, total: 250 }, leftOut: { gifts: 1, total: 25 } });
    assert.deepEqual(p["2024"].waiting, { gifts: 1, total: 10 });
  });

  it("a donor's cash and in-kind", () => {
    const s = givingSplit([{ donorId: "a", kind: "cash", totalValue: 100 }, { donorId: "a", kind: "in_kind", totalValue: 40 }, { donorId: "a", kind: "cash", totalValue: 1 }, { donorId: "b", kind: "in_kind", totalValue: 7 }]);
    assert.deepEqual([s.get("a"), s.get("b")], [{ cash: 101, inKind: 40 }, { cash: 0, inKind: 7 }]);
  });
});

describe("an invoice number already recorded", () => {
  it("finds it on the tracker and in the donor list, once, whatever the leading zeros", async () => {
    const { invoiceMatches } = await import("../lib/utils/cash-gifts.ts");
    const lines = [line("Mario Chavez", 10000, { invoiceNumber: "0328" }), line("Ana Cruz", 500, { invoiceNumber: "0400" })];
    const gifts = [
      { donorId: "d1", date: "2026-01-02", kind: "cash", totalValue: 10000, invoiceNumber: "0328" }, // the tracker's line, posted
      { donorId: "d2", date: "2026-03-01", kind: "cash", totalValue: 250, invoiceNumber: "328" }, // typed by hand
      { donorId: "d2", date: "2026-03-01", kind: "in_kind", totalValue: 99, invoiceNumber: "0328" },
    ];
    const names = new Map([["d1", "Mario Chavez"], ["d2", "Bea Lim"]]);
    assert.deepEqual(invoiceMatches(" 328 ", lines, gifts, names), [
      { donor: "Mario Chavez", amount: 10000, date: "2026-01-02", where: "tracker" },
      { donor: "Bea Lim", amount: 250, date: "2026-03-01", where: "donor list" },
    ]);
    assert.deepEqual(invoiceMatches("", lines, gifts, names), []);
    assert.deepEqual(invoiceMatches("0999", lines, gifts, names), []);
    assert.equal(invoiceMatches("0", [line("Zero", 1, { invoiceNumber: "0" })], [], names).length, 1);
  });
});

describe("the name key", () => {
  // The database writes the same key (ops.donor_name_key, 0084): scripts/rls/donor-totals-matrix.mjs checks these very pairs.
  it("matches across titles, capitals, accents, punctuation, initials and word order", () => {
    assert.equal(donorNameKey("Ms. María  Santos-Cruz"), "cruz maria santos");
    assert.equal(donorNameKey("Jessa C. Calma"), "calma jessa");
    assert.equal(donorNameKey("SAMPLE FOOD CORP."), "corp food sample");
    assert.equal(donorNameKey("Carlo/Joy De Jesus"), "carlo de jesus joy");
    assert.equal(donorNameKey("3M Philippines, Inc."), "3m inc philippines");
  });
});
