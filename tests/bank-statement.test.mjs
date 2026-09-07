// Unit tests for lib/utils/bank-statement.ts -- reading a bank export and
// checking it hangs together. Pure, so these run without a DOM or a database.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  categorize,
  checkContinuity,
  naturalKey,
  parseAmount,
  parseBankCsv,
  parseCsv,
  parseDate,
  summarizeBatch,
} from "../lib/utils/bank-statement.ts";

const HEADER = "Posting Date,Branch,Description,Debit,Credit,Running Balance,Check Number,";

describe("parseCsv", () => {
  it("keeps commas, quotes and newlines inside quoted fields", () => {
    const grid = parseCsv('a,"b, c","say ""hi""","line\nbreak"\r\n1,2,3,4');
    assert.deepEqual(grid, [["a", "b, c", 'say "hi"', "line\nbreak"], ["1", "2", "3", "4"]]);
  });

  it("drops blank lines and a leading BOM", () => {
    assert.deepEqual(parseCsv("﻿x,y\n\n1,2\n"), [["x", "y"], ["1", "2"]]);
  });
});

describe("parseAmount / parseDate", () => {
  it("reads money the way banks write it", () => {
    assert.equal(parseAmount("1,234.50"), 1234.5);
    assert.equal(parseAmount("₱1,234.00"), 1234);
    assert.equal(parseAmount("(500.00)"), -500);
    assert.equal(parseAmount("-19.10"), -19.1);
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount("n/a"), null);
  });

  it("reads the date formats an export might use", () => {
    assert.equal(parseDate("2026-01-02"), "2026-01-02");
    assert.equal(parseDate("2026-01-02 00:00:00"), "2026-01-02");
    assert.equal(parseDate("1/2/2026"), "2026-01-02");
    assert.equal(parseDate("02-Jan-2026"), "2026-01-02");
    assert.equal(parseDate("Jan 2, 2026"), "2026-01-02");
    assert.equal(parseDate("Posting Date"), null);
  });
});

describe("parseBankCsv", () => {
  it("reads the foundation's own export, memo column included", () => {
    const text = [
      HEADER,
      "2026-01-02,OTHER BANKS,000590086790 9 IBTD,,181.64,328061.72,0.0,BUTCH",
      "2026-01-02,TBG-BUSINESS ONLINE BANKING,BOB IBFT OPR-12292025,5441.67,,322620.05,0.0,DHEN SALARY DEC 16-31",
    ].join("\n");
    const { rows, problems } = parseBankCsv(text);
    assert.equal(problems.length, 0);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0], {
      rowSeq: 1,
      postingDate: "2026-01-02",
      branch: "OTHER BANKS",
      description: "000590086790 9 IBTD",
      debit: 0,
      credit: 181.64,
      runningBalance: 328061.72,
      checkNumber: null,
      memo: "BUTCH",
    });
    assert.equal(rows[1].debit, 5441.67);
    assert.equal(rows[1].memo, "DHEN SALARY DEC 16-31");
  });

  it("is indifferent to column order and case", () => {
    const text = ["running balance,DESCRIPTION,Credit,Debit,posting date", "100.00,Deposit,100.00,,1/5/2026"].join("\n");
    const { rows, problems } = parseBankCsv(text);
    assert.equal(problems.length, 0);
    assert.equal(rows[0].credit, 100);
    assert.equal(rows[0].postingDate, "2026-01-05");
  });

  it("moves a negative amount to the other column", () => {
    const text = [HEADER, "2026-01-02,,Refund,(50.00),,150.00,,"].join("\n");
    const { rows } = parseBankCsv(text);
    assert.equal(rows[0].debit, 0);
    assert.equal(rows[0].credit, 50);
  });

  it("skips a header repeated mid-file and reports a bad date", () => {
    const text = [HEADER, "2026-01-02,,Row one,,10.00,10.00,,", HEADER, "not a date,,Row two,,10.00,20.00,,"].join("\n");
    const { rows, problems } = parseBankCsv(text);
    assert.equal(rows.length, 1);
    assert.equal(problems.length, 1);
    assert.match(problems[0].message, /Line 4/);
  });

  it("refuses a file without the columns it needs", () => {
    const { rows, problems } = parseBankCsv("Date,Amount\n2026-01-02,5");
    assert.equal(rows.length, 0);
    assert.match(problems[0].message, /running balance|debit\/credit/i);
  });
});

describe("categorize", () => {
  it("tags the bank's own interest, both sides", () => {
    assert.equal(categorize("INTEREST PAYMENT SYS GEN"), "interest");
    assert.equal(categorize("INTEREST WITHHELD"), "interest");
  });

  it("tags charges, and leaves everything else alone", () => {
    assert.equal(categorize("SERVICE CHARGE"), "fee");
    assert.equal(categorize("BANK FEE MAR"), "fee");
    assert.equal(categorize("BOB IBFT OPR-12292025"), null);
  });
});

describe("checkContinuity", () => {
  const row = (seq, date, debit, credit, balance) => ({
    rowSeq: seq, postingDate: date, branch: null, description: "x", debit, credit, runningBalance: balance, checkNumber: null, memo: null,
  });

  it("is quiet when each day closes where it should", () => {
    const rows = [row(1, "2026-01-02", 0, 100, 1100), row(2, "2026-01-02", 30, 0, 1070), row(3, "2026-01-03", 0, 5, 1075)];
    assert.deepEqual(checkContinuity(rows, 1000), []);
  });

  it("does not mind the bank posting a day's lines out of order", () => {
    // Interest paid then withheld, but listed the other way round -- the
    // per-line balances cross, the day still closes correctly.
    const rows = [row(1, "2026-01-30", 3.65, 0, 318537.1), row(2, "2026-01-30", 0, 18.25, 318540.75)];
    assert.deepEqual(checkContinuity(rows, 318522.5), []);
  });

  it("flags a day that does not follow from the day before", () => {
    const rows = [row(1, "2026-01-02", 0, 100, 1100), row(2, "2026-01-03", 0, 5, 2000)];
    const warnings = checkContinuity(rows, 1000);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].postingDate, "2026-01-03");
    assert.equal(warnings[0].expected, 1105);
  });

  it("checks the first day against the stored opening balance when given one", () => {
    const rows = [row(1, "2026-08-01", 0, 100, 2437618.16)];
    assert.deepEqual(checkContinuity(rows, 2437518.16), []);
    assert.equal(checkContinuity(rows, 2000000).length, 1);
    assert.deepEqual(checkContinuity(rows), []);
  });
});

describe("naturalKey and summarizeBatch", () => {
  it("keys on account, date, description, both amounts and the balance", () => {
    const a = { postingDate: "2026-04-06", description: "BOB IBFT", debit: 15025, credit: 0, runningBalance: 954349.71 };
    const b = { ...a, runningBalance: 969374.71 };
    assert.notEqual(naturalKey(a, "acct"), naturalKey(b, "acct"));
    assert.equal(naturalKey(a, "acct"), "acct|2026-04-06|BOB IBFT|15025.00|0.00|954349.71");
  });

  it("summarises a batch and implies its opening balance", () => {
    const rows = [
      { rowSeq: 1, postingDate: "2026-01-02", branch: null, description: "a", debit: 0, credit: 181.64, runningBalance: 328061.72, checkNumber: null, memo: null },
      { rowSeq: 2, postingDate: "2026-01-03", branch: null, description: "b", debit: 61.72, credit: 0, runningBalance: 328000, checkNumber: null, memo: null },
    ];
    assert.deepEqual(summarizeBatch(rows), {
      coversFrom: "2026-01-02",
      coversTo: "2026-01-03",
      impliedOpening: 327880.08,
      closing: 328000,
      totalDebits: 61.72,
      totalCredits: 181.64,
    });
    assert.equal(summarizeBatch([]), null);
  });
});
