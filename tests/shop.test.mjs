// The Shop (0155): the catalogue's small rules: addresses and item codes, what is left to sell, low stock,
// why a product isn't on the site yet, and reading a typed amount.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DELIVERY_AREAS, SKU_RE, SLUG_RE, STOCK_REASONS, isLow, leftToSell, marginOf, priceRange, publishProblems, readAmount, recountChange, skuFor, slugFor } from "../lib/utils/shop.ts";

const sql = readFileSync(new URL("../supabase/migrations/0155_shop_catalogue.sql", import.meta.url), "utf8");

it("a product's address is made from its name and passes the database's rule", () => {
  assert.equal(slugFor("Our Children. Our Future. Tee"), "our-children-our-future-tee");
  assert.equal(slugFor("  Little Crew Kids' Tee "), "little-crew-kids-tee");
  assert.equal(slugFor("Home & desk — Café"), "home-and-desk-cafe");
  assert.equal(slugFor("!!!"), "");
  for (const name of ["Give Hope Hoodie", "Serve with Faith Tumbler", "A".repeat(200)]) assert.match(slugFor(name), SLUG_RE);
  assert.ok(slugFor("A".repeat(200)).length <= 80);
});

it("an item code is readable, unique per colour and size, and passes the database's rule", () => {
  assert.equal(skuFor("give-hope-tee", "Navy", "M"), "GIVE-HOPE-TEE-NAVY-M");
  assert.equal(skuFor("lead-with-love-mug", "", ""), "LEAD-WITH-LOVE-MUG");
  assert.equal(skuFor("little-crew-kids-tee", "Sky blue", "10-12"), "LITTLE-CREW-KIDS-TEE-SKYBLU-1012");
  for (const [slug, colour, size] of [["our-children-our-future-tee", "White", "2XL"], ["x", "", ""], ["a-very-long-product-address-that-runs-on-and-on", "Royal blue", "XXXL"]]) {
    const sku = skuFor(slug, colour, size);
    assert.ok(sku.length <= 40);
    if (sku.length >= 3) assert.match(sku, SKU_RE);
  }
});

it("what is left to sell is the count less what unpaid orders hold, never below nothing", () => {
  assert.equal(leftToSell({ stock: 10, held: 3 }), 7);
  assert.equal(leftToSell({ stock: 2, held: 5 }), 0);
});

it("an item is low at or under its reorder point, and only while it is on sale", () => {
  assert.equal(isLow({ stock: 5, held: 0, reorderAt: 5, active: true }), true);
  assert.equal(isLow({ stock: 6, held: 0, reorderAt: 5, active: true }), false);
  assert.equal(isLow({ stock: 6, held: 2, reorderAt: 5, active: true }), true);
  assert.equal(isLow({ stock: 0, held: 0, reorderAt: 0, active: true }), true);
  assert.equal(isLow({ stock: 0, held: 0, reorderAt: 0, active: false }), false);
});

it("the earnings of a piece need its cost", () => {
  assert.equal(marginOf({ price: 450, cost: 190 }), 260);
  assert.equal(marginOf({ price: 450, cost: null }), null);
  assert.equal(marginOf({ price: 99.95, cost: 33.33 }), 66.62);
});

it("a product's price reads as one price or a range of the items on sale", () => {
  assert.equal(priceRange([{ price: 450, active: true }, { price: 450, active: true }]), "₱450");
  assert.equal(priceRange([{ price: 450, active: true }, { price: 1250, active: true }, { price: 9999, active: false }]), "₱450 to ₱1,250");
  assert.equal(priceRange([{ price: 450, active: false }]), "No item on sale");
});

it("a product shows on the site only with a photo, an item on sale and published", () => {
  assert.deepEqual(publishProblems({ status: "published" }, [{ active: true }], [{}]), []);
  assert.deepEqual(publishProblems({ status: "draft" }, [], []), ["Add a photo", "Add an item on sale", "It is still a draft"]);
  assert.deepEqual(publishProblems({ status: "hidden" }, [{ active: false }], [{}]), ["Add an item on sale", "It is hidden"]);
});

it("a recount sends the difference", () => {
  assert.equal(recountChange(10, 7), -3);
  assert.equal(recountChange(0, 12), 12);
});

it("a typed amount is read as pesos, or refused", () => {
  assert.equal(readAmount("450"), 450);
  assert.equal(readAmount("₱1,250.50"), 1250.5);
  assert.equal(readAmount(" 95.5 "), 95.5);
  for (const bad of ["", "abc", "-5", "1.234", "4 50x", "1e3"]) assert.equal(readAmount(bad), null);
});

it("the page's lists match the database's rules", () => {
  for (const area of DELIVERY_AREAS) assert.ok(sql.includes(`'${area}'`), area);
  assert.match(sql, /area in \('Metro Manila', 'Luzon', 'Visayas', 'Mindanao'\)/);
  // Staff may use exactly these reasons; 'sold' and 'cancelled' belong to the order functions.
  const allowed = sql.match(/p_reason not in \(([^)]+)\)/)[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(STOCK_REASONS.map((r) => r.value).sort(), allowed);
  assert.match(sql, /status in \('draft', 'published', 'hidden'\)/);
  assert.match(sql, /supply in \('stock', 'made'\)/);
});

it("the public site's login is granted the storefront function and nothing else", () => {
  assert.match(sql, /revoke all on all functions in schema shop from public, anon, authenticated, shop_web;/);
  const grants = [...sql.matchAll(/grant ([^;]+) to shop_web;/g)].map((m) => m[1].trim());
  assert.deepEqual(grants, ["usage on schema shop", "execute on function shop.web_catalog()"]);
  assert.ok(!/create role shop_web[^;]*(login|password)/i.test(sql.replace(/nologin/g, "")), "no password or login in the migration");
});
