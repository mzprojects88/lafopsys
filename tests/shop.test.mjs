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

it("every shop function is closed to the public, and the site's login gets only the storefront ones (0155 to 0157)", () => {
  for (const file of ["0155_shop_catalogue.sql", "0156_shop_orders.sql", "0157_shop_fulfilment.sql", "0159_shop_menu_order.sql"]) {
    const text = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    const made = [...new Set([...text.matchAll(/create or replace function shop\.([a-z_]+)\(/g)].map((m) => m[1]))];
    assert.ok(made.length > 0, file);
    const revoke = text.match(/revoke all on (all functions in schema shop|function [^;]+) from public, anon, authenticated, shop_web;/);
    assert.ok(revoke, `${file} revokes its functions from the public`);
    for (const fn of made) {
      // A trigger function is not callable by anyone anyway; every other function must be named in the revoke.
      if (fn === "touch") continue;
      assert.ok(revoke[1].startsWith("all functions") || revoke[1].includes(`shop.${fn}(`), `${file}: ${fn} is revoked from the public`);
      const toSite = new RegExp(`grant execute on function shop\\.${fn}\\([^)]*\\) to shop_web;`).test(text);
      assert.equal(toSite, fn.startsWith("web_"), `${file}: ${fn} ${fn.startsWith("web_") ? "is" : "is not"} granted to the site`);
    }
    for (const m of text.matchAll(/grant ([^;]+) to shop_web;/g)) assert.match(m[1].trim(), /^usage on schema shop$|^execute on function shop\.web_/, m[1]);
    assert.ok(!/grant[^;]*\bon (table )?shop\.[a-z_]+[^;]*to shop_web/.test(text.replace(/grant execute on function[^;]+;/g, "")), `${file} grants the site no table`);
  }
});

// ---- Orders and proceeds (0156, 0157) ----
const { ORDER_QUEUES, ORDER_STATUS_LABEL, addressOf, earned, isSold, manilaDay, nextStep, proceedsByDay, proceedsOf, queueOf, soldByItem, soldIn } = await import("../lib/utils/shop.ts");
const order = (over = {}) => ({ id: "o1", status: "paid", delivery: "courier", paidAt: "2026-11-17T01:00:00Z", subtotal: 900, deliveryFee: 95, total: 995, payFee: 15, payNet: 980, postedSourceId: "", ...over });

it("each order has one next step, and a finished or unpaid one has none", () => {
  assert.deepEqual(nextStep({ status: "paid", delivery: "courier" }), { step: "pack", label: "Mark packed" });
  assert.equal(nextStep({ status: "packed", delivery: "courier" }).step, "ship");
  assert.equal(nextStep({ status: "packed", delivery: "pickup" }).step, "ready");
  assert.equal(nextStep({ status: "shipped", delivery: "courier" }).label, "Mark delivered");
  assert.equal(nextStep({ status: "ready", delivery: "pickup" }).label, "Mark picked up");
  for (const status of ["placed", "delivered", "expired", "cancelled", "refunded"]) assert.equal(nextStep({ status, delivery: "courier" }), null, status);
});

it("every status has a name and a list on the Orders page, as the database lists them", () => {
  const orders = readFileSync(new URL("../supabase/migrations/0156_shop_orders.sql", import.meta.url), "utf8");
  const statuses = orders.match(/status in \(([^)]+)\)\)/)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(Object.keys(ORDER_STATUS_LABEL).sort(), statuses.slice().sort());
  const keys = ORDER_QUEUES.map((q) => q.key);
  for (const status of statuses) assert.ok(keys.includes(queueOf({ status })), status);
  assert.deepEqual(statuses.filter((status) => isSold({ status })), ["paid", "packed", "shipped", "ready", "delivered"]);
  assert.equal(queueOf({ status: "packed" }), "todo");
  assert.equal(queueOf({ status: "ready" }), "out");
  assert.equal(queueOf({ status: "refunded" }), "closed");
});

it("an order counts on the Manila day its payment arrived", () => {
  assert.equal(manilaDay("2026-11-16T15:59:59Z"), "2026-11-16");
  assert.equal(manilaDay("2026-11-16T16:00:00Z"), "2026-11-17");
  const all = [order(), order({ id: "o2", paidAt: "2026-11-16T16:30:00Z" }), order({ id: "o3", paidAt: "2026-11-15T10:00:00Z" }), order({ id: "o4", status: "refunded" }), order({ id: "o5", status: "placed", paidAt: null })];
  assert.deepEqual(soldIn(all, { from: "2026-11-17", to: "2026-11-17" }).map((o) => o.id), ["o1", "o2"]);
  assert.deepEqual(soldIn(all, null).map((o) => o.id), ["o1", "o2", "o3"]);
});

it("proceeds: what was sold, the fees, what reached the foundation, and what the goods earned", () => {
  const sold = [order(), order({ id: "o2", subtotal: 280, deliveryFee: 0, total: 280, payFee: null, payNet: null })];
  const lines = [{ orderId: "o1", qty: 2, unitCost: 190 }, { orderId: "o2", qty: 1, unitCost: 120 }, { orderId: "other", qty: 9, unitCost: 1 }];
  const t = proceedsOf(sold, lines);
  assert.deepEqual(t, { orders: 2, sold: 1275, goods: 1180, delivery: 95, fees: 15, net: 1260, cost: 500, costMissing: 0 });
  assert.equal(earned(t), 665, "goods 1,180 less cost 500 and fees 15; delivery fees are the courier's");
  assert.equal(earned(proceedsOf(sold, [{ orderId: "o1", qty: 2, unitCost: null }])), null, "no earnings figure while a sold line has no cost");
  assert.equal(proceedsOf([], lines).sold, 0);
});

it("proceeds by day, newest first, with the day's cash book entry", () => {
  const days = proceedsByDay([order(), order({ paidAt: "2026-11-17T05:00:00Z", total: 100, payFee: 2, payNet: 98 }), order({ paidAt: "2026-11-15T05:00:00Z", postedSourceId: "shop:2026-11-15" })]);
  assert.deepEqual(days, [
    { day: "2026-11-17", orders: 2, sold: 1095, fees: 17, net: 1078, posted: "" },
    { day: "2026-11-15", orders: 1, sold: 995, fees: 15, net: 980, posted: "shop:2026-11-15" },
  ]);
});

it("what sold by item, best seller first; a line without cost leaves the item's cost unknown", () => {
  const lines = [
    { orderId: "o1", name: "Tee", option: "Navy, M", qty: 2, unitCost: 190, lineTotal: 900 },
    { orderId: "o1", name: "Mug", option: "", qty: 1, unitCost: null, lineTotal: 280 },
    { orderId: "o2", name: "Tee", option: "Navy, M", qty: 1, unitCost: 190, lineTotal: 450 },
    { orderId: "unsold", name: "Tee", option: "Navy, M", qty: 5, unitCost: 190, lineTotal: 2250 },
  ];
  assert.deepEqual(soldByItem([{ id: "o1" }, { id: "o2" }], lines), [
    { name: "Tee", option: "Navy, M", qty: 3, sales: 1350, cost: 570 },
    { name: "Mug", option: "", qty: 1, sales: 280, cost: null },
  ]);
});

it("a delivery address reads on one line", () => {
  assert.equal(addressOf({ addressLine: "00 Sample Street", barangay: "Roxas", city: "Quezon City", province: "Metro Manila", postalCode: "1103" }), "00 Sample Street, Brgy. Roxas, Quezon City, Metro Manila, 1103");
  assert.equal(addressOf({ addressLine: "00 Sample Street", barangay: "", city: "Cebu City", province: "Cebu", postalCode: "" }), "00 Sample Street, Cebu City, Cebu");
});

it("the staff step and the cash book posting keep their guards (0157)", () => {
  const text = readFileSync(new URL("../supabase/migrations/0157_shop_fulfilment.sql", import.meta.url), "utf8");
  assert.match(text, /if not shared\.module_editable\('shop'\) then\s+raise exception 'Only people who may edit the Shop work on orders'/);
  assert.match(text, /if not \(shared\.module_editable\('finance'\) and shared\.module_viewable\('shop'\)\) then/);
  assert.match(text, /if not \(select cash_posting from shop\.settings\) then/);
  assert.match(text, /cash_posting boolean not null default false/, "posting to the cash book starts switched off");
  assert.match(text, /grant execute on function shop\.order_step\(uuid, text, jsonb\) to authenticated;/);
  assert.ok(!/grant[^;]*on shop\.outbox to (anon|shop_web|public)/.test(text), "the outbox is not open to the site");
  assert.ok(!/grant (insert|update|delete|all)[^;]*on shop\.(orders|outbox)[^;]*to authenticated/.test(text), "staff change orders only through the step function");
});

it("a payment method reads in plain words", async () => {
  const { payMethodLabel } = await import("../lib/utils/shop.ts");
  assert.equal(payMethodLabel("qrph"), "QR Ph");
  assert.equal(payMethodLabel("GCASH"), "GCash");
  assert.equal(payMethodLabel("some_new_way"), "some new way");
  assert.equal(payMethodLabel(""), "Online payment");
});

it("the Shop sales card is in the catalogue and in the database's list of cards (0158)", async () => {
  const { CARDS, ACTIONS } = await import("../lib/utils/dashboard-catalog.ts");
  const text = readFileSync(new URL("../supabase/migrations/0158_shop_dashboard_card.sql", import.meta.url), "utf8");
  const allowed = text.match(/check \(card in \(([^;]+)\)\);/)[1].replace(/\s+/g, " ").split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(allowed.slice().sort(), CARDS.map((c) => c.key).sort(), "the database allows exactly the catalogue's cards");
  assert.equal(CARDS.find((c) => c.key === "shop").main, false, "it is offered, not forced onto everyone's dashboard");
  assert.match(text, /unnest\(array\['shop_admin', 'finance', 'ceo'\]\)/);
  assert.equal(ACTIONS.find((a) => a.key === "shop_orders").href, "/shop/orders");
});
