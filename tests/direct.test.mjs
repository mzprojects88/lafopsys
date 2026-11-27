import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { directCardToken, itemsLabel, progress, shareNow } from "../lib/direct/direct.ts";

const item = (over) => ({ itemId: "i", name: "Toy", uom: "pc", share: 2, left: 30, given: 0, wasted: 0, ...over });

describe("direct donations (Inventory 0082)", () => {
  it("progress: whole percents of everything received that add up to 100", () => {
    assert.deepEqual(progress({ given: 8, left: 22, wasted: 0 }), { total: 30, given: 27, left: 73, wasted: 0 });
    assert.deepEqual(progress({ given: 1, left: 1, wasted: 1 }), { total: 3, given: 33, left: 34, wasted: 33 });
    assert.deepEqual(progress({ given: 0, left: 0, wasted: 0 }), { total: 0, given: 0, left: 0, wasted: 0 });
  });
  it("one share now: each item's share, less when less is left, nothing of an item that ran out", () => {
    const now = shareNow([item({}), item({ itemId: "b", name: "Book", share: 1, left: 0 }), item({ itemId: "c", name: "Crayons", uom: "box", share: 2, left: 1 })]);
    assert.equal(itemsLabel(now), "2 pc Toy, 1 box Crayons");
  });
  it("a card's code: the ArkOS link or the bare code, nothing else", () => {
    const t = "0123456789abcdef0123456789abcdef";
    assert.equal(directCardToken("https://arkos.littlearkfoundation.org/c/" + t), t);
    assert.equal(directCardToken(t), t);
    assert.equal(directCardToken("https://example.com/x"), null);
  });
});
