// lib/files/data-url.ts (0149): uploads checked by their bytes.
import { it } from "node:test";
import assert from "node:assert/strict";
import { decodeDataUrl } from "../lib/files/data-url.ts";

const url = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array(20).fill(0)];
const jpeg = [0xff, 0xd8, 0xff, 0xe0, ...new Array(20).fill(1), 0xff, 0xd9];

it("accepts a real PNG and a JPEG, also one padded after its end marker", () => {
  assert.ok(decodeDataUrl(url("image/png", png), ["image/png"], 1024));
  assert.ok(decodeDataUrl(url("image/jpeg", jpeg), ["image/jpeg"], 1024));
  assert.ok(decodeDataUrl(url("image/jpeg", [...jpeg, 0, 0, 0]), ["image/jpeg"], 1024));
});

it("refuses a fake header, the wrong type, and too many bytes", () => {
  assert.equal(decodeDataUrl(url("image/png", [0x89, 0x50, 0x4e, 0x47, ...new Array(30).fill(65)]), ["image/png"], 1024), null);
  assert.equal(decodeDataUrl(url("image/jpeg", [0xff, 0xd8, 0xff, ...new Array(30).fill(65)]), ["image/jpeg"], 1024), null);
  assert.equal(decodeDataUrl(url("image/png", png), ["image/jpeg"], 1024), null);
  assert.equal(decodeDataUrl(url("image/png", png), ["image/png"], 10), null);
});
