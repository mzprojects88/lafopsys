import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildIdCardsPdf, cardQr, initials, qrRects, CARD_LINK_BASE } from "../lib/pdf/id-card.ts";
import { LAF_LOGO_JPEG } from "../lib/pdf/laf-logo.ts";

const logo = { jpeg: Buffer.from(LAF_LOGO_JPEG.base64, "base64"), width: LAF_LOGO_JPEG.width, height: LAF_LOGO_JPEG.height };
const card = (n) => ({
  name: "Ana Sample",
  caseNumber: "LFCN-2026-0123",
  carer: { name: "Rosa Sample", relationship: "Mother" },
  version: n,
  issuedOn: "Nov 18, 2026",
  token: "0123456789abcdef0123456789abcdef",
});
const pages = (pdf) => (pdf.toString("latin1").match(/\/Type \/Page /g) ?? []).length;

describe("Patient ID cards (0164)", () => {
  it("three cards a page, front and back side by side", async () => {
    assert.equal(pages(await buildIdCardsPdf([card(1), card(2), card(3)], { logo, address: "35 Tulip St." })), 1);
    assert.equal(pages(await buildIdCardsPdf([card(1), card(2), card(3), card(4)], { logo, address: "" })), 2);
  });

  it("the QR holds the card's link and nothing else", async () => {
    const qr = await cardQr("0123456789abcdef0123456789abcdef");
    assert.ok(qr.columns >= 21 && qr.columns === qr.rows, `a square QR, got ${qr.columns}x${qr.rows}`);
    assert.equal(CARD_LINK_BASE, "https://arkos.littlearkfoundation.org/c/");
  });

  it("a QR row's neighbouring modules become one rectangle", () => {
    assert.deepEqual(qrRects([1, 1, 0, 1], 4, 1, 4), [{ x: 0, y: 0, w: 2, h: 1 }, { x: 3, y: 0, w: 1, h: 1 }]);
  });

  it("initials: first and last name", () => {
    assert.equal(initials("Ana Maria Sample"), "AS");
    assert.equal(initials("Ana"), "A");
    assert.equal(initials("Juan Miguel Sample-Delacruz Jr."), "JS");
  });
});

describe("the Patient ID card template (0169)", async () => {
  const { normalizeCardTemplate, DEFAULT_CARD_TEMPLATE, CARD_TEXT_LIMITS } = await import("../lib/utils/id-card-template.ts");
  const { SAMPLE_CARDS } = await import("../lib/pdf/id-card.ts");

  it("nothing saved is the LAF design; unknown keys, colours and layouts fall back to it", () => {
    assert.deepEqual(normalizeCardTemplate(null), DEFAULT_CARD_TEMPLATE);
    const t = normalizeCardTemplate({ theme: "#ff0000", layout: "poster", extra: "x", show: { carer: "no" } });
    assert.equal(t.theme, "storybook");
    assert.equal(t.layout, "fold");
    assert.equal(t.show.carer, true);
    assert.equal("extra" in t, false);
  });

  it("texts are cleaned and cut to their limits; the title and footer line never go empty", () => {
    const t = normalizeCardTemplate({ title: "  ", qrCaption: "a\u0000b\n  c", footer: ["", ""], back: { intro: "x".repeat(500) }, marks: ["Stay", "", 7] });
    assert.equal(t.title, "PATIENT ID");
    assert.equal(t.qrCaption, "a b c");
    assert.deepEqual(t.footer, ["Our Children. Our Future.", ""]);
    assert.equal(t.back.intro.length, CARD_TEXT_LIMITS.intro);
    assert.deepEqual(t.marks, ["Stay", "", "Goods"]);
  });

  it("the storybook artwork is stored once however many cards; the plain looks still print", async () => {
    const one = await buildIdCardsPdf(SAMPLE_CARDS.slice(0, 1), { logo, address: "" });
    const nine = await buildIdCardsPdf(Array.from({ length: 9 }, (_, i) => card(i + 1)), { logo, address: "", template: normalizeCardTemplate({ layout: "duplex" }) });
    assert.ok(nine.length < one.length * 1.6, `art repeated: ${one.length} -> ${nine.length} bytes`);
    assert.equal(pages(await buildIdCardsPdf(SAMPLE_CARDS, { logo, address: "", template: normalizeCardTemplate({ theme: "laf_navy" }) })), 1);
  });

  it("two-sided: nine fronts a page, then their backs; the fold sheet stays three a page", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => card(i + 1));
    const duplex = normalizeCardTemplate({ layout: "duplex" });
    assert.equal(pages(await buildIdCardsPdf(ten.slice(0, 9), { logo, address: "", template: duplex })), 2);
    assert.equal(pages(await buildIdCardsPdf(ten, { logo, address: "", template: duplex })), 4);
    assert.equal(pages(await buildIdCardsPdf(ten, { logo, address: "" })), 4);
  });

  it("every line hidden, the longest texts and the samples still print", async () => {
    const L = CARD_TEXT_LIMITS;
    const long = normalizeCardTemplate({
      theme: "calm_green",
      show: { caseNumber: false, carer: false, cardLine: false, marks: false },
      title: "W".repeat(L.title), qrCaption: "W".repeat(L.qrCaption), footer: ["W".repeat(L.footer0), "W".repeat(L.footer1)],
      back: { heading: ["W".repeat(L.heading), "W".repeat(L.heading)], intro: "Word ".repeat(40), privacy: "Word ".repeat(30), lost: "Word ".repeat(30), found: "Word ".repeat(20) },
    });
    assert.equal(pages(await buildIdCardsPdf(SAMPLE_CARDS, { logo, address: "35 Tulip Street, Quezon City, Metro Manila", template: long })), 1);
  });
});

describe("reading a card's QR (0165)", async () => {
  const { cardToken } = await import("../lib/utils/card-token.ts");
  it("takes the code from the card's link, or a bare code; anything else is not a card", () => {
    const code = "0123456789abcdef0123456789abcdef";
    assert.equal(cardToken(`https://arkos.littlearkfoundation.org/c/${code}`), code);
    assert.equal(cardToken(`https://lafopsys.vercel.app/c/${code}?x=1`), code);
    assert.equal(cardToken(code), code);
    assert.equal(cardToken("LFCN-2026-0123"), null);
    assert.equal(cardToken(`https://example.com/c/${code}0`), null);
  });
});
