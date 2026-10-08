// Unit tests for lib/utils/donor-format.ts: LAF's donor name style, on real cases from the register.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDonorName } from "../lib/utils/donor-format.ts";

const f = (raw) => formatDonorName(raw);

describe("donor name format", () => {
  it("people: Title Case, particles lower-case, hyphens kept", () => {
    assert.equal(f("IRELYN TUAZON-DOMINGO").name, "Irelyn Tuazon-Domingo");
    assert.equal(f("JUAN DELA CRUZ").name, "Juan dela Cruz");
    assert.equal(f("maria de los santos").name, "Maria de los Santos");
    assert.equal(f("jose rizal jr").name, "Jose Rizal Jr.");
    assert.equal(f("Jewel c. Calica").name, "Jewel C. Calica");
    assert.equal(f("  ANSON   ANG ").name, "Anson Ang");
    assert.equal(f("ANSON ANG").suggestedType, "individual");
  });

  it("titles move to the salutation; one given name is incomplete", () => {
    assert.deepEqual([f("Mr. Ansong Ang").name, f("Mr. Ansong Ang").salutation], ["Ansong Ang", "Mr."]);
    const grace = f("Ma'am Grace");
    assert.deepEqual([grace.name, grace.salutation, grace.incomplete], ["Grace", "Ma'am", true]);
    assert.equal(f("DR. MARIA SANTOS").salutation, "Dr.");
    assert.equal(f("Maria Santos").incomplete, false);
  });

  it("keeps what was written on purpose (cases from the dry run on the register)", () => {
    assert.equal(f("JM Protectors").name, "JM Protectors");
    assert.equal(f("IQ Prado").name, "IQ Prado");
    assert.equal(f("BNI").name, "BNI");
    assert.equal(f("Rosalyn V. Musingi").name, "Rosalyn V. Musingi");
    assert.equal(f("Juanita Baisa (Mama Emma)").name, "Juanita Baisa (Mama Emma)");
    assert.equal(f("Jenny,Manette, Joy").name, "Jenny, Manette, Joy");
    const co = f("Kristine S. Co");
    assert.deepEqual([co.name, co.suggestedType], ["Kristine S. Co", "individual"]);
    assert.equal(f("Garcia Family & Friends").suggestedType, "individual");
    assert.equal(f("DJ Meleya Supporters").suggestedType, "individual");
    assert.equal(f("NATIONAL UNIVERSITY FV SHS STUDENTS GOVERNMENT").suggestedType, "foundation");
    assert.equal(f("JR & R DISTRIBUTOR'S INC.").suggestedType, "corporate");
  });

  it("couples and lists of people keep their titles in the name; short org acronyms stay", () => {
    const c = f("MR. AND MRS. DE JESUS");
    assert.deepEqual([c.name, c.salutation], ["Mr. and Mrs. de Jesus", null]);
    assert.equal(f("MS. IRISH BULOS, MS TERESITA SANTOS").name, "Ms. Irish Bulos, Ms. Teresita Santos");
    assert.equal(f("AFC FOODS").name, "AFC Foods");
    assert.equal(f("THE FOOD BANK").name, "The Food Bank");
  });

  it("an outside decision on the kind of donor changes how the rules write it", () => {
    assert.equal(formatDonorName("JES LIVES").name, "Jes Lives");
    assert.equal(formatDonorName("JES LIVES", "organisation").name, "JES Lives");
    assert.equal(formatDonorName("ALPHA PHI OMEGA", "organisation").name, "Alpha Phi Omega");
    assert.equal(formatDonorName("BREADCOM DEACONS", "organisation").name, "Breadcom Deacons");
    assert.equal(formatDonorName("UP ALCHEMES", "organisation").name, "UP Alchemes");
  });

  it("keywords decide the type before the AI does", async () => {
    const { typeFromKeywords } = await import("../lib/utils/donor-format.ts");
    assert.equal(typeFromKeywords("Garcia Family & Friends"), "individual");
    assert.equal(typeFromKeywords("DJ Meleya Supporters"), "individual");
    assert.equal(typeFromKeywords("ELCEE DUQUE & FRIENDS"), "individual");
    assert.equal(typeFromKeywords("KAMI NAMAN CHARITY WORKS"), "foundation");
    assert.equal(typeFromKeywords("MASONIC CORREGIDOR LODGE"), "foundation");
    assert.equal(typeFromKeywords("BK SYSTEMS PHILIPPINES, INC."), "corporate");
    assert.equal(typeFromKeywords("JANUS"), null);
    assert.equal(typeFromKeywords("Maria Santos"), null);
  });

  it("households stay one donor", () => {
    assert.equal(f("JUAN & MARIA SANTOS").name, "Juan & Maria Santos");
    assert.equal(f("juan and maria santos").name, "Juan and Maria Santos");
  });

  it("organisations as registered: suffixes tidied, acronyms kept, typed correctly", () => {
    const corp = f("ALTERNATIVES FOOD CORP");
    assert.deepEqual([corp.name, corp.kind, corp.suggestedType], ["Alternatives Food Corp.", "organisation", "corporate"]);
    assert.equal(f("ALTERNATIVES FOOD CORP.").name, "Alternatives Food Corp.");
    const lodge = f("MASONIC CORREGIDOR LODGE");
    assert.deepEqual([lodge.name, lodge.suggestedType], ["Masonic Corregidor Lodge", "foundation"]);
    assert.equal(f("BDO FOUNDATION").name, "BDO Foundation");
    assert.equal(f("DSWD NCR").suggestedType, "government");
    assert.equal(f("Jollibee Foods Corporation").name, "Jollibee Foods Corporation");
    assert.equal(f("DJ Meleya Supporters").name, "DJ Meleya Supporters");
  });
});
