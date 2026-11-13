import { deflateSync } from "node:zlib";

/**
 * A very small PDF writer, enough for sheets of labels and nothing more.
 *
 * Written by hand rather than pulled from a package because the whole job is
 * filled rectangles and short lines of text. Codes are drawn as vector
 * rectangles instead of pictures, which is what keeps the files small and
 * makes them print sharp at any size: a sheet of fifty codes lands in tens of
 * kilobytes rather than the megabytes a page of images would cost.
 *
 * Text uses Helvetica, one of the fourteen faces every PDF reader already
 * has, so no font is embedded. Pictures are JPEGs, which a PDF carries as
 * they are (DCTDecode) -- no decoding, no library -- enough for a logo.
 */

export * from "./page.ts";
import { A4, PdfPage, escapeText, num, type PdfImage } from "./page.ts";

/** Assembles the pages into a file. Content streams are deflated, which is
 * where most of the saving comes from once a page holds a few hundred
 * rectangles. */
export function buildPdf(pages: PdfPage[], title: string): Buffer {
  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (text: string | Buffer) => {
    const buf = Buffer.isBuffer(text) ? text : Buffer.from(text, "latin1");
    chunks.push(buf);
    length += buf.length;
  };
  const startObject = (index: number) => {
    offsets[index] = length;
    push(`${index} 0 obj\n`);
  };

  push("%PDF-1.4\n");

  const pageCount = Math.max(pages.length, 1);
  const fontRegular = 3;
  const fontBold = 4;
  const firstPage = 5;
  const pageIds = Array.from({ length: pageCount }, (_, i) => firstPage + i * 2);

  startObject(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  startObject(2);
  push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>\nendobj\n`);

  startObject(fontRegular);
  push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);

  startObject(fontBold);
  push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);

  const rendered = pages.length > 0 ? pages : [new PdfPage()];
  // Images are written after the info object; pages refer ahead to them.
  const images = [...new Set(rendered.flatMap((page) => page.images))];
  const imageId = (img: PdfImage) => firstPage + pageCount * 2 + 1 + images.indexOf(img);
  rendered.forEach((page, index) => {
    const pageId = pageIds[index]!;
    const contentId = pageId + 1;
    const xobjects = page.images.map((img, i) => `/Im${i + 1} ${imageId(img)} 0 R`).join(" ");
    startObject(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(A4.width)} ${num(A4.height)}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${contentId} 0 R >>\nendobj\n`
    );

    const stream = deflateSync(Buffer.from(page.ops.join("\n"), "latin1"));
    startObject(contentId);
    push(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`);
    push(stream);
    push("\nendstream\nendobj\n");
  });

  const infoId = firstPage + pageCount * 2;
  startObject(infoId);
  push(`<< /Title (${escapeText(title)}) /Producer (LAF Inventory) >>\nendobj\n`);

  images.forEach((img) => {
    startObject(imageId(img));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
    );
    push(img.jpeg);
    push("\nendstream\nendobj\n");
  });

  const xrefOffset = length;
  const maxId = infoId + images.length;
  push(`xref\n0 ${maxId + 1}\n`);
  push("0000000000 65535 f \n");
  for (let id = 1; id <= maxId; id += 1) {
    const offset = offsets[id] ?? 0;
    push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

