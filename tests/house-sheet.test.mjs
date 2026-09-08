import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  firstDateIn,
  indexPatients,
  matchDeterministic,
  nameKey,
  normalizeName,
  parseRosterCsv,
  parseTabDate,
  parseTabList,
  reconcileRoster,
  similarity,
  splitName,
} from "../lib/utils/house-sheet.ts";

describe("parseTabDate", () => {
  it("reads the three shapes the workbook uses, month first", () => {
    assert.equal(parseTabDate("09/09/2026"), "2026-09-09");
    assert.equal(parseTabDate("12/10/25"), "2025-12-10");
    assert.equal(parseTabDate("12/3/25"), "2025-12-03");
    assert.equal(parseTabDate("  09/08/2026"), "2026-09-08");
    assert.equal(parseTabDate("09092026"), "2026-09-09");
    assert.equal(parseTabDate("120325"), "2025-12-03");
    assert.equal(parseTabDate("90326"), "2026-09-03");
  });
  it("rejects what is not a date", () => {
    assert.equal(parseTabDate("Sheet1"), null);
    assert.equal(parseTabDate("13/40/2026"), null);
    assert.equal(parseTabDate("02/30/2026"), null);
  });
});

describe("parseTabList", () => {
  it("finds the tabs in the htmlview page and orders them newest first", () => {
    const html =
      'var items = [];items.push({name: "  09\\/08\\/2026", pageUrl: "https:\\/\\/x\\/sheet?gid=2", gid: "2",initialSheet: false});' +
      'items.push({name: "  09\\/09\\/2026", pageUrl: "https:\\/\\/x\\/sheet?gid=1", gid: "1",initialSheet: false});' +
      'items.push({name: "Notes", pageUrl: "https:\\/\\/x\\/sheet?gid=9", gid: "9",initialSheet: false});';
    const tabs = parseTabList(html);
    assert.deepEqual(
      tabs.map((t) => [t.name, t.gid, t.date]),
      [
        ["09/09/2026", "1", "2026-09-09"],
        ["09/08/2026", "2", "2026-09-08"],
        ["Notes", "9", null],
      ]
    );
  });
});

describe("names", () => {
  it("splits Last, First and First Last", () => {
    assert.deepEqual(splitName("Carpio, Kieth Xander"), { first: "Kieth Xander", last: "Carpio" });
    assert.deepEqual(splitName("Jennifer Borreta"), { first: "Jennifer", last: "Borreta" });
    assert.deepEqual(splitName("Ma. Lara Abaño"), { first: "Ma.", last: "Lara Abaño" });
    assert.deepEqual(splitName("Madonna"), { first: "", last: "Madonna" });
  });
  it("normalises case, punctuation and spacing but keeps ñ", () => {
    assert.equal(normalizeName("  CASTILLO,  ANGELA "), "castillo angela");
    assert.equal(normalizeName("Ocenar, Ronie Jr."), "ocenar ronie jr");
    assert.equal(normalizeName("Castañeda"), "castañeda");
    assert.equal(nameKey("NARON, LANZ JHOEY"), "naron|lanz jhoey");
    assert.equal(nameKey("Lanz Jhoey Naron".replace("Lanz Jhoey Naron", "Naron, Lanz Jhoey")), "naron|lanz jhoey");
  });
});

describe("firstDateIn", () => {
  it("takes the first American-order date out of free text", () => {
    assert.equal(firstDateIn("9/7/2026"), "2026-09-07");
    assert.equal(firstDateIn("9/9/26 - 09/11/2026"), "2026-09-09");
    assert.equal(firstDateIn("9/11/26"), "2026-09-11");
    assert.equal(firstDateIn("telemed"), null);
    assert.equal(firstDateIn(null), null);
  });
});

const CSV = [
  " ,Patient's Name,Carer's Name,Relationship to Patient,Next Appointment,Treatment,Address,,,,,,,,,,",
  '1,"Ocenar, Ronie Jr.","Ocenar, Noeme",mother,,,Samar,LAF,,,,,,,,,',
  '4,"Botona, Rhianne Gwen",Jennifer Borreta,mother ,,,Taguig,,,,,,,,,,938648297',
  '12,"Clerigo, Nhicole","Clerigo, Janice",mother,9/9/26 - 09/11/2026,"Vinc, IT","Bicutan, Taguig",,,,,,,,,,',
  "13,,,,,,,,,,,,,,,,",
  '14,"CASTILLO, ANGELA","CASTILLO, OFELIA",MOTHER,9/11/26,FF UP,"Sariaya, Quezon",9911799806,,,,,,,,,',
  '15,"castillo, angela","dup",,,,,,,,,,,,,,',
].join("\n");

describe("parseRosterCsv", () => {
  it("reads the labelled columns and the two unlabelled ones by value", () => {
    const r = parseRosterCsv(CSV);
    assert.deepEqual(r.problems, []);
    assert.equal(r.rows.length, 4);
    assert.equal(r.duplicates, 1);
    const [ocenar, botona, clerigo, castillo] = r.rows;
    assert.equal(ocenar.rowNo, 1);
    assert.equal(ocenar.nameKey, "ocenar|ronie jr");
    assert.equal(ocenar.lafFlag, true);
    assert.equal(ocenar.phone, null);
    assert.equal(ocenar.address, "Samar");
    assert.equal(botona.phone, "938648297");
    assert.equal(botona.lafFlag, false);
    assert.equal(botona.carerName, "Jennifer Borreta");
    assert.equal(clerigo.nextAppointmentRaw, "9/9/26 - 09/11/2026");
    assert.equal(clerigo.nextAppointmentOn, "2026-09-09");
    assert.equal(clerigo.treatment, "Vinc, IT");
    assert.equal(castillo.phone, "9911799806");
    assert.equal(castillo.relationship, "MOTHER");
    assert.equal(castillo.nextAppointmentOn, "2026-09-11");
  });
  it("finds the header below a stray row and copes with a different column order", () => {
    const csv = ["Occupancy 09/09", "Count,Carers Name,Patients Name,Relationship", "1,Mom,\"Cruz, Ana\",mother"].join("\n");
    const r = parseRosterCsv(csv);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].patientName, "Cruz, Ana");
    assert.equal(r.rows[0].carerName, "Mom");
  });
  it("reports a sheet with no patient column", () => {
    const r = parseRosterCsv("a,b,c\n1,2,3");
    assert.equal(r.rows.length, 0);
    assert.match(r.problems[0], /Patient's Name/);
  });
});

const PATIENTS = [
  { id: "p1", patientNumber: "51", firstName: "Kieth Xander Ero", lastName: "Carpio", birthDate: "2015-01-01", province: null, city: null, carerNames: ["Jennebeth Carpio"] },
  { id: "p2", patientNumber: "53", firstName: "Cassiah  Mary Monjardin", lastName: "Abines", birthDate: null, province: null, city: null, carerNames: [] },
  { id: "p3", patientNumber: "160", firstName: "Ace Jhereil", lastName: "Bestudio", birthDate: null, province: null, city: null, carerNames: [] },
  { id: "p4", patientNumber: "37", firstName: "Marco  James", lastName: "Cardiño", birthDate: null, province: null, city: null, carerNames: [] },
  { id: "p5", patientNumber: "38", firstName: "Mark Anthony", lastName: "Cardiño", birthDate: null, province: null, city: null, carerNames: [] },
  { id: "p6", patientNumber: "18", firstName: "Alter Psalm DC.", lastName: "Castañeda", birthDate: null, province: null, city: null, carerNames: [] },
  { id: "p7", patientNumber: "130", firstName: "Jon Casciel C.", lastName: "Castañeda", birthDate: null, province: null, city: null, carerNames: [] },
  { id: "p8", patientNumber: "58", firstName: "Khen Kyrie Abaño", lastName: "De Aldo", birthDate: null, province: null, city: null, carerNames: [] },
];
const INDEX = indexPatients(PATIENTS);

describe("matchDeterministic", () => {
  it("matches an exact name whatever the case and spacing", () => {
    assert.deepEqual(matchDeterministic("BESTUDIO, ACE JHEREIL", INDEX), { kind: "exact", patientId: "p3" });
    assert.deepEqual(matchDeterministic("Cardiño, Marco James", INDEX), { kind: "exact", patientId: "p4" });
  });
  it("matches on the first token when the record carries a middle name and only one fits", () => {
    assert.deepEqual(matchDeterministic("Carpio, Kieth Xander", INDEX), { kind: "loose", patientId: "p1" });
    assert.deepEqual(matchDeterministic("Abines, Cassiah", INDEX), { kind: "loose", patientId: "p2" });
    assert.deepEqual(matchDeterministic("De Aldo, Khen Kyrie", INDEX), { kind: "loose", patientId: "p8" });
  });
  it("does not guess between two siblings", () => {
    const r = matchDeterministic("Cardiño, Mar", INDEX);
    assert.equal(r.kind, "candidates");
    assert.deepEqual(
      r.candidates.map((c) => c.id),
      ["p4", "p5"]
    );
  });
  it("offers a shortlist for a misspelling and nothing for a stranger", () => {
    const r = matchDeterministic("Castaneda, Jon Kasciel", INDEX);
    assert.equal(r.kind, "candidates");
    assert.equal(r.candidates[0].id, "p7");
    const s = matchDeterministic("Zzyzx, Qwerty", INDEX);
    assert.equal(s.kind, "candidates");
    assert.equal(s.candidates.length, 0);
  });
  it("similarity is symmetric and bounded", () => {
    assert.equal(similarity("carpio kieth", "carpio kieth"), 1);
    assert.equal(similarity("abc", "xyz"), 0);
    assert.equal(similarity("castaneda jon", "castañeda jon casciel c"), similarity("castañeda jon casciel c", "castaneda jon"));
  });
});

const db = (over = {}) => ({
  id: "r1",
  nameKey: "ocenar|ronie jr",
  patientName: "Ocenar, Ronie Jr.",
  carerName: "Ocenar, Noeme",
  relationship: "mother",
  nextAppointmentRaw: null,
  nextAppointmentOn: null,
  treatment: null,
  address: "Samar",
  lafFlag: true,
  phone: null,
  firstSeenOn: "2026-09-08",
  lastSeenOn: "2026-09-08",
  daysSeen: 1,
  offSheetAt: null,
  ...over,
});
const roster = parseRosterCsv(CSV).rows;

describe("reconcileRoster", () => {
  it("inserts new people, extends the day count, and marks the missing off-sheet on the newest day", () => {
    const plan = reconcileRoster({ tabDate: "2026-09-09", roster, db: [db(), db({ id: "gone", nameKey: "gone|x", patientName: "Gone, X" })], now: "2026-09-09T00:00:00Z" });
    assert.equal(plan.inserts.length, 3);
    assert.equal(plan.inserts[0].first_seen_on, "2026-09-09");
    const u = plan.updates.find((x) => x.id === "r1");
    assert.deepEqual(u.patch, { last_seen_on: "2026-09-09", days_seen: 2, row_no: 1 });
    assert.deepEqual(plan.offSheet, ["gone"]);
    assert.deepEqual(plan.counts, { seen: 4, inserted: 3, updated: 0, offSheet: 1, returned: 0 });
  });
  it("carries changed details from a newer day and brings a returning person back on-sheet", () => {
    const plan = reconcileRoster({
      tabDate: "2026-09-09",
      roster,
      db: [db({ address: "Leyte", offSheetAt: "2026-09-05T00:00:00Z", lastSeenOn: "2026-09-04" })],
      now: "2026-09-09T00:00:00Z",
    });
    const u = plan.updates.find((x) => x.id === "r1");
    assert.equal(u.patch.address, "Samar");
    assert.equal(u.patch.off_sheet_at, null);
    assert.equal(plan.counts.returned, 1);
    assert.equal(plan.counts.updated, 1);
  });
  it("an older tab (backfill) never overwrites newer details or marks anyone off-sheet", () => {
    const plan = reconcileRoster({ tabDate: "2026-09-01", roster, db: [db({ address: "Leyte" }), db({ id: "gone", nameKey: "gone|x", patientName: "Gone, X" })], now: "2026-09-09T00:00:00Z" });
    assert.equal(plan.updates.find((x) => x.id === "r1"), undefined);
    assert.deepEqual(plan.offSheet, []);
  });
});
