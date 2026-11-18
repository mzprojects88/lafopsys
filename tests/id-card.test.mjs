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
