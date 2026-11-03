import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMS, FORM_IDS, SESSION_FORMS, cleanData, prefillData, caseNumberFor, DOCUMENT_KINDS, REQUIRED_KINDS } from "../lib/case-files/forms.ts";

test("every form has unique field keys and options", () => {
  for (const id of FORM_IDS) {
    const keys = FORMS[id].fields.map((f) => f.key);
    assert.equal(new Set(keys).size, keys.length, `${id} repeats a key`);
    for (const f of FORMS[id].fields) if ("options" in f) assert.equal(new Set(f.options).size, f.options.length, `${id}.${f.key} repeats an option`);
    if (FORMS[id].nextSessionKey) assert.ok(keys.includes(FORMS[id].nextSessionKey), `${id} next-session key missing`);
  }
  assert.deepEqual(SESSION_FORMS, ["casework", "counseling", "home_visit", "monitoring"]);
  for (const k of REQUIRED_KINDS) assert.ok(k in DOCUMENT_KINDS);
});

test("cleanData keeps only what the form defines, in its shape", () => {
  const out = cleanData("casework", {
    concerns: ["Food and daily meal needs", "Made up concern"],
    summary: "  Talked about school.  ",
    attached: "not a list",
    injected: "<script>",
  });
  assert.deepEqual(out, { concerns: ["Food and daily meal needs"], summary: "Talked about school." });
  const intake = cleanData("intake", {
    carer_civil_status: "Married",
    medical_priority: "Priority Z",
    referral_date: "2026-11-03",
    consent_signed_on: "03/11/2026",
    family: [{ name: "A", relationship: "Mother", extra: "x" }, { nothing: "" }],
  });
  assert.deepEqual(intake, { carer_civil_status: "Married", referral_date: "2026-11-03", family: [{ name: "A", relationship: "Mother" }] });
  const visit = cleanData("home_visit", { home_areas: { "Water supply": "Satisfactory", "Roof": "Satisfactory", "Toilet and sanitation": "Bad" }, time_started: "09:30" });
  assert.deepEqual(visit, { home_areas: { "Water supply": "Satisfactory" }, time_started: "09:30" });
  assert.deepEqual(cleanData("progress_note", null), {});
});

test("prefill fills from the patient record or the paper's wording, never over an answer", () => {
  const filled = prefillData("intake", { religion: "Roman Catholic", reasonForReferral: "" }, { place_of_birth: "Typed" });
  assert.equal(filled.religion, "Roman Catholic");
  assert.equal(filled.place_of_birth, "Typed");
  assert.equal(filled.referred_by, "National Children's Hospital");
  assert.equal(filled.problem_presented, undefined);
  assert.match(String(prefillData("casework", {}).purpose), /^The casework session/);
});

test("the PDF uses the app's case number unless the original is asked for", () => {
  const p = { caseNumber: "LFCN-2026-0012", legacyCode: "LAF-2026-139-B" };
  assert.equal(caseNumberFor(p, false), "LFCN-2026-0012");
  assert.equal(caseNumberFor(p, true), "LAF-2026-139-B");
  assert.equal(caseNumberFor({ caseNumber: "LFCN-2026-0012", legacyCode: null }, true), "LFCN-2026-0012");
});

test("each form prints with its title, ticks, signatures and page breaks", async () => {
  const { layoutCaseRecord, buildCaseRecordPdf } = await import("../lib/pdf/case-record.ts");
  const { dataFromPairs } = await import("../lib/case-files/forms.ts");
  for (const form of FORM_IDS) {
    const long = "A long narrative sentence for the record. ".repeat(60);
    const data = Object.fromEntries(FORMS[form].fields.filter((f) => f.type === "textarea").map((f) => [f.key, long]));
    const first = FORMS[form].fields.find((f) => f.type === "checks");
    if (first) data[first.key] = [first.options[0]];
    const d = { form, caseNumber: "LFCN-2026-0012", childName: "Child, Test", ageSex: "9 y/o / Female", heldOn: "2026-11-03", data, preparedBy: "Social Worker A", approvedBy: "Social Worker A", approvedOn: "2026-11-03", ceoName: "CEO Name" };
    const pages = layoutCaseRecord(d);
    const svg = pages.map((p) => p.svg.join("")).join("");
    assert.ok(svg.includes(FORMS[form].title.toUpperCase().replace(/&/g, "&amp;")), `${form} title`);
    assert.ok(svg.includes("Case No. LFCN-2026-0012"), `${form} case number`);
    assert.ok(svg.includes("Noted by: Chief Executive Officer"), `${form} CEO line`);
    assert.equal(svg.includes("Conforme"), FORMS[form].conforme, `${form} conforme`);
    if (first) assert.ok(svg.includes(`[x] ${first.options[0]}`) && svg.includes(`[ ] ${first.options[1]}`), `${form} ticks`);
    if (Object.keys(data).length > 2) assert.ok(pages.length > 1, `${form} breaks pages`);
    assert.equal(buildCaseRecordPdf(d).subarray(0, 5).toString(), "%PDF-");
  }
  assert.deepEqual(dataFromPairs("casework", [{ key: "concerns", value: "Food and daily meal needs | Not an option" }, { key: "summary", value: "Talked." }, { key: "unknown", value: "x" }]), {
    concerns: ["Food and daily meal needs"],
    summary: "Talked.",
  });
  assert.deepEqual(dataFromPairs("home_visit", [{ key: "follow_up", value: '[{"need":"Food","action":"Refer"}]' }, { key: "home_areas", value: "not json" }]), { follow_up: [{ need: "Food", action: "Refer" }] });
});
