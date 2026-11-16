// Signatures on generated documents (0153): a PNG is decoded and placed in a PDF with its transparency, a JPEG
// passes through, the document list matches the database's check, and a builder prints the picture only when given.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { decodePng, jpegSize, signatureImage } from "../lib/pdf/png.ts";
import { PdfPage, buildPdf } from "../lib/pdf/writer.ts";
import { buildCashAr } from "../lib/pdf/cash-ar.ts";
import { SIGNATURE_DOC_KEYS } from "../lib/signatures/docs.ts";

/** A PNG from raw filtered rows (CRCs are not checked by the reader). */
function png(width, height, type, rows) {
  const chunk = (name, data) => Buffer.concat([Buffer.from([data.length >>> 24, data.length >>> 16, data.length >>> 8, data.length].map((v) => v & 255)), Buffer.from(name, "latin1"), data, Buffer.alloc(4)]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = type;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows.map((r) => Buffer.from(r))))), chunk("IEND", Buffer.alloc(0))]);
}
// 2 x 2 RGBA: row 1 plain (filter 0), row 2 "Up" (filter 2) with zeros, so it repeats row 1.
const RGBA = png(2, 2, 6, [[0, 10, 20, 30, 255, 40, 50, 60, 0], [2, 0, 0, 0, 0, 0, 0, 0, 0]]);

it("a PNG with transparency: decoded, its second row un-filtered, and placed with a soft mask", () => {
  const img = decodePng(RGBA);
  assert.equal(img.width, 2);
  assert.equal(img.height, 2);
  assert.ok(img.alpha, "transparency kept");
  const page = new PdfPage();
  page.signature(img, 100, 200, 120, 30);
  const pdf = buildPdf([page], "t").toString("latin1");
  assert.match(pdf, /\/Filter \/FlateDecode \/SMask \d+ 0 R/);
  assert.match(pdf, /\/ColorSpace \/DeviceGray/);
  // Fitted into the box (2 x 2 into 120 x 30 -> 30 x 30) and resting on the line.
  assert.match(page.ops.at(-1), /^q 30 0 0 30 100 /);
  assert.ok(page.svg.at(-1).includes("data:image/png;base64,"));
});

it("an opaque PNG has no mask; a broken file or an unsupported one is refused, not drawn", () => {
  const opaque = decodePng(png(1, 1, 2, [[0, 1, 2, 3]]));
  assert.equal(opaque.alpha, undefined);
  assert.equal(decodePng(Buffer.from("not a png")), null);
  assert.equal(decodePng(RGBA.subarray(0, 40)), null);
  const page = new PdfPage();
  page.signature(undefined, 0, 0, 100);
  assert.equal(page.ops.length, 0);
});

it("a JPEG keeps its bytes and gets its size from the frame header", () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 40, 0, 120, 1, 1, 0x11, 0, 0xff, 0xd9]);
  assert.deepEqual(jpegSize(jpg), { width: 120, height: 40 });
  assert.equal(signatureImage(jpg, "image/jpeg").jpeg.length, jpg.length);
  assert.equal(signatureImage(Buffer.from("x"), "image/jpeg"), null);
});

it("the documents a person may allow are the ones the database accepts (0153)", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0153_signature_on_documents.sql", import.meta.url), "utf8");
  const list = sql.match(/allowed_docs <@ array\[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual([...list].sort(), [...SIGNATURE_DOC_KEYS].sort());
});

it("a receipt carries the issuer's signature only when one is handed to it", () => {
  const data = { arNumber: "LAF-CSH-2026-0001", date: "2026-11-16", donorName: "A donor", amount: 100, currency: "PHP", receivedBy: "Sample Finance" };
  assert.ok(!buildCashAr(data).toString("latin1").includes("/SMask"));
  assert.ok(buildCashAr({ ...data, receivedBySignature: decodePng(RGBA) }).toString("latin1").includes("/SMask"));
});
