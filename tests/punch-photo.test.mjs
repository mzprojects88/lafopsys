// Unit tests for lib/utils/punch-photo.ts -- what the punch route accepts as a photo (0060).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeJpegDataUrl, punchPhotoKey, PHOTO_MAX_BYTES } from "../lib/utils/punch-photo.ts";

const jpeg = (size) => {
  const b = Buffer.alloc(size, 7);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff;
  return `data:image/jpeg;base64,${b.toString("base64")}`;
};

describe("decodeJpegDataUrl", () => {
  it("accepts a JPEG the app would send", () => {
    assert.equal(decodeJpegDataUrl(jpeg(50_000))?.length, 50_000);
  });
  it("refuses what is not a JPEG, whatever its label says", () => {
    const png = `data:image/jpeg;base64,${Buffer.from("\x89PNG" + "x".repeat(200)).toString("base64")}`;
    assert.equal(decodeJpegDataUrl(png), null);
    assert.equal(decodeJpegDataUrl("data:image/png;base64,AAAA"), null);
    assert.equal(decodeJpegDataUrl(undefined), null);
  });
  it("refuses one too large or too small", () => {
    assert.equal(decodeJpegDataUrl(jpeg(PHOTO_MAX_BYTES + 1)), null);
    assert.equal(decodeJpegDataUrl(jpeg(50)), null);
  });
});

describe("punchPhotoKey", () => {
  it("files by month, then person", () => {
    assert.equal(punchPhotoKey("s1", "p1", "2026-09-24"), "DTR photos/2026-09/s1/p1.jpg");
  });
});
