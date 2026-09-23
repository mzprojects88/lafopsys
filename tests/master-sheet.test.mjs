// Unit tests for lib/utils/master-sheet.ts -- reading LAF's Patients Database
// sheet into patient records (0057). Names here are invented.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  caseNumberFromCode,
  diagnosisCategory,
  diagnosisKey,
  intakeFor,
  masterPatch,
  matchMasterRow,
  normalizePhone,
  parseDistanceCsv,
  parseIntakeCsv,
  parseMasterCsv,
  phaseKey,
  refId,
  regionName,
  sheetAgeBracket,
  sheetDate,
} from "../lib/utils/master-sheet.ts";

const MASTER = [
  "CN,DE,NAME,BD,AUA,PA,AB,S,ADD,P/C,R,PS,I,D,TP,CARER,RX,CP,MS,P,REMARKS,CODE",
  '1,6/27/2024,"Dela Cruz, Juan Miguel",3/14/2016,8 years,10 years,5 to 10,M,"Brgy. 1, Antipolo",Rizal,RIV-A,On-going Treatment,C,BCell ALL,Maintenance,"Dela Cruz, Ana",Mother,9171234567,M,A,,LAF-2024-001-C',
  '2,9/19/2026,"Santos, Liza",12/1/2020,,,,F,Quezon City,Metro Manila,NCR,Expired,T,Beta Thalassemia,Expired,"Santos, Rey",Father,09181234567 / 9191234567,LI,,RIP/JUL 2025,',
  ",,,,0 years,,,,,,,,,,,,,,,,,",
  "x,1/1/2024,No Number,,,,,,,,,,,,,,,,,,,",
  '1,1/1/2024,"Twice, Again",,,,,,,,,,,,,,,,,,,',
].join("\n");

describe("parseMasterCsv", () => {
  const { rows, problems } = parseMasterCsv(MASTER);
  it("reads each child once, by CN, and skips the sheet's empty rows", () => {
    assert.equal(rows.length, 2);
    assert.deepEqual(problems, ["Row 5: no CN, skipped", "CN 1 appears twice; the first row is used"]);
  });
  it("maps the columns the app keeps", () => {
    const r = rows[0];
    assert.equal(r.cn, "1");
    assert.equal(r.admittedOn, "2024-06-27");
    assert.equal(r.firstName, "Juan Miguel");
    assert.equal(r.lastName, "Dela Cruz");
    assert.equal(r.birthDate, "2016-03-14");
    assert.equal(r.sex, "M");
    assert.equal(r.status, "ongoing");
    assert.equal(r.illnessCode, "C");
    assert.equal(r.priority, "A");
    assert.equal(r.carerPhone, "09171234567");
    assert.equal(r.legacyCode, "LAF-2024-001-C");
  });
  it("reads Expired as a status and several phones as a list", () => {
    const r = rows[1];
    assert.equal(r.status, "expired");
    assert.equal(r.carerPhone, "09181234567 / 09191234567");
    assert.equal(r.remarks, "RIP/JUL 2025");
    assert.equal(r.priority, null);
  });
  it("refuses a sheet without its CN column", () => {
    assert.equal(parseMasterCsv("NAME\nX").rows.length, 0);
  });
});

describe("cells", () => {
  it("dates", () => {
    assert.equal(sheetDate("1/5/26"), "2026-01-05");
    assert.equal(sheetDate("2/30/2026"), null);
    assert.equal(sheetDate("monitoring"), null);
  });
  it("case number from the old CODE, without the illness letter", () => {
    assert.equal(caseNumberFromCode("LAF-2024-001-C"), "LFCN-2024-0001");
    assert.equal(caseNumberFromCode("laf-2026-187-FD"), "LFCN-2026-0187");
    assert.equal(caseNumberFromCode("LAF-2024-000-C"), null);
    assert.equal(caseNumberFromCode(""), null);
  });
  it("regions as ops.provinces writes them", () => {
    assert.equal(regionName("RIV-A"), "Region IV-A");
    assert.equal(regionName("RIII"), "Region III");
    assert.equal(regionName("NCR"), "NCR");
    assert.equal(regionName("RXIII"), "Region XIII");
    assert.equal(regionName("somewhere"), null);
  });
  it("phones regain their leading 0", () => {
    assert.equal(normalizePhone("9755997520"), "09755997520");
    assert.equal(normalizePhone(""), null);
  });
  it("age brackets from age today", () => {
    assert.deepEqual([0, 4, 5, 9, 10, 14, 15, 17, 18, 21].map(sheetAgeBracket),
      ["0 to 5", "0 to 5", "5 to 10", "5 to 10", "10 to 15", "10 to 15", "15 to 18", "15 to 18", "18+", "18+"]);
  });
});

describe("reference names follow the importer", () => {
  it("abbreviations resolve to the diagnosis already on the list", () => {
    assert.equal(diagnosisKey("BCell ALL"), "acute lymphoblastic leukemia");
    assert.equal(diagnosisKey(" AML "), "acute myeloid leukemia");
    assert.equal(diagnosisKey("Wilms Tumor"), "wilms tumor");
  });
  it("Expired is never a phase", () => {
    assert.equal(phaseKey("Expired"), null);
    assert.equal(phaseKey("In Remission"), "in remission");
  });
  it("a new diagnosis takes its category from the illness code", () => {
    assert.equal(diagnosisCategory("Sacrococcygeal Teratoma", "C"), "cancer");
    assert.equal(diagnosisCategory("Hemophilia A", "B"), "other");
    assert.equal(diagnosisCategory("Beta Thalassemia", null), "thalassemia");
  });
  it("new ids never collide", () => {
    assert.equal(refId("dx", "T-Cell Leukemia", new Set()), "dx-t-cell-leukemia");
    assert.equal(refId("dx", "T-Cell Leukemia", new Set(["dx-t-cell-leukemia"])), "dx-t-cell-leukemia-2");
  });
});

describe("masterPatch", () => {
  const have = {
    patient_number: "1", first_name: "Juan", last_name: "Dela Cruz", birth_date: "2016-03-14", sex: "M", raw_address: "A",
    province_id: "prov-rizal", status: "ongoing", illness_code: null, treatment_phase_id: "phase-maintenance",
    marital_status: "M", remarks: null, priority: null, legacy_code: null, admitted_at: "2024-06-27", distance_km: 34,
  };
  it("the sheet wins where it has a value, a blank cell keeps the app's", () => {
    assert.deepEqual(masterPatch({ status: "expired", remarks: "RIP", raw_address: null, distance_km: 34 }, have), { status: "expired", remarks: "RIP" });
  });
  it("an unchanged record changes nothing", () => {
    assert.deepEqual(masterPatch({ first_name: "Juan", status: "ongoing" }, have), {});
  });
});

describe("matchMasterRow", () => {
  const row = { cn: "7", firstName: "Juan Miguel", lastName: "Dela Cruz", birthDate: "2016-03-14" };
  const p = (id, cn, first = "Juan Miguel", last = "Dela Cruz", bd = "2016-03-14") =>
    ({ id, patient_number: cn, first_name: first, last_name: last, birth_date: bd });
  it("the CN first", () => {
    assert.deepEqual(matchMasterRow(row, [p("a", null), p("b", "7", "Other", "Kid")]), { kind: "cn", id: "b" });
  });
  it("a child admitted in the app before the sheet listed them", () => {
    assert.deepEqual(matchMasterRow(row, [p("a", null, "juan  miguel", "DELA CRUZ")]), { kind: "name", id: "a" });
    assert.deepEqual(matchMasterRow(row, [p("a", null, "Juan Miguel", "Dela Cruz", "2016-03-15")]), { kind: "new" });
  });
  it("never guesses", () => {
    assert.equal(matchMasterRow(row, [p("a", null), p("b", null)]).kind, "conflict");
    assert.equal(matchMasterRow(row, [p("a", "3")]).kind, "conflict");
  });
  it("a namesake with another CN and birthday is a different child", () => {
    assert.deepEqual(matchMasterRow(row, [p("a", "3", "Juan Miguel", "Dela Cruz", "2019-01-01")]), { kind: "new" });
  });
});

describe("masterPatch on instants", () => {
  it("the same moment in two zones is no change", () => {
    const have = { consent_authorized_at: "2025-09-05T06:03:22+00:00" };
    assert.deepEqual(masterPatch({ consent_authorized_at: "2025-09-05T14:03:22+08:00" }, have), {});
  });
});

describe("other tabs", () => {
  it("distance from the Extract tab", () => {
    const csv = ["CN,DE,NAME,DIST,Address,Km", "1,x,y,1,Addr,34 km", "2,x,y,2,Addr,", "3,x,y,3,Addr,120 km "].join("\n");
    assert.deepEqual([...parseDistanceCsv(csv)], [["1", 34], ["3", 120]]);
  });
  it("the intake form, with its second header part-way down", () => {
    const csv = [
      "Timestamp,Authorization,Name,Birthday,Name of MSS,Solo Photo of the Patient,,,",
      '9/5/2025 14:03:22,I authorize.,Juan Miguel Dela Cruz,3/14/2016,Ms. Reyes,https://drive.google.com/open?id=1,,,',
      ",,,,,,Attending Physician,Occupation,Type of Housing",
      '1/2/2026 9:00:00,I authorize.,Liza Santos,12/1/2020,,,"Dr. Cruz, MD",Jobless,Rented',
    ].join("\n");
    const rows = parseIntakeCsv(csv);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].submittedAt, "2025-09-05T14:03:22+08:00");
    assert.equal(rows[0].authorized, true);
    assert.equal(rows[0].mssName, "Ms. Reyes");
    assert.equal(rows[0].links.photo, "https://drive.google.com/open?id=1");
    assert.equal(rows[1].attendingPhysician, "Dr. Cruz, MD");
    assert.equal(rows[1].parentOccupation, "Jobless");
    assert.equal(rows[1].housingType, "Rented");
    const hit = intakeFor({ firstName: "Juan Miguel", lastName: "Dela Cruz", birthDate: "2016-03-14" }, rows);
    assert.equal(hit?.mssName, "Ms. Reyes");
    assert.equal(intakeFor({ firstName: "Juan", lastName: "Dela Cruz", birthDate: "2016-03-15" }, rows), null);
  });
});
