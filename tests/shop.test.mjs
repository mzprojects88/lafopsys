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
  for (const file of ["0155_shop_catalogue.sql", "0156_shop_orders.sql", "0157_shop_fulfilment.sql", "0159_shop_menu_order.sql", "0160_shop_customers.sql", "0161_shop_gifts.sql", "0162_shop_close_clears_trail.sql"]) {
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
  // The list of cards the database allows is restated by each migration that adds one: the latest is 0189 (donations for patients).
  const latest = readFileSync(new URL("../supabase/migrations/0189_dashboard_card_direct.sql", import.meta.url), "utf8");
  const allowed = latest.match(/check \(card in \(([^;]+)\)\);/)[1].replace(/\s+/g, " ").split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.ok(allowed.includes("shop") && allowed.includes("bookings"));
  assert.deepEqual(allowed.slice().sort(), CARDS.map((c) => c.key).sort(), "the database allows exactly the catalogue's cards");
  assert.equal(CARDS.find((c) => c.key === "shop").main, false, "it is offered, not forced onto everyone's dashboard");
  assert.match(text, /unnest\(array\['shop_admin', 'finance', 'ceo'\]\)/);
  assert.equal(ACTIONS.find((a) => a.key === "shop_orders").href, "/shop/orders");
});

// ---- Customers (0160) ----
const { CUSTOMER_VIEWS, customerMatches, customerRows, customerViewDate, customersIn, isGiven, readGiving } = await import("../lib/utils/shop.ts");
const cust = (over = {}) => ({ id: "c1", email: "one@example.com", name: "Sample One", phone: "0917 000 0001", area: "Luzon", province: "Laguna", city: "Calamba", barangay: "", postalCode: "", addressLine: "1 Sample St", landmark: "", status: "active", statusAt: null, createdAt: "2026-11-10T02:00:00Z", lastSignInAt: "2026-11-17T02:00:00Z", signInCount: 3, ...over });
const sale = (over = {}) => ({ id: "o1", customerId: null, number: "LAF-SHP-2026-00001", status: "paid", name: "Guest Buyer", email: "Guest@Example.com", phone: "0918 111 1111", area: "Metro Manila", city: "Quezon City", total: 500, placedAt: "2026-11-12T03:00:00Z", ...over });

it("the customer list has each account once and each guest address once, with their orders", () => {
  const rows = customerRows(
    [cust(), cust({ id: "c2", email: "two@example.com", name: "Sample Two", createdAt: "2026-11-16T02:00:00Z", lastSignInAt: null })],
    [
      sale({ id: "o1", customerId: "c1", total: 450, placedAt: "2026-11-11T03:00:00Z", status: "delivered" }),
      sale({ id: "o2", customerId: "c1", number: "LAF-SHP-2026-00002", total: 300, placedAt: "2026-11-15T03:00:00Z", status: "expired" }),
      sale({ id: "o3", number: "LAF-SHP-2026-00003", total: 500, placedAt: "2026-11-12T03:00:00Z" }),
      sale({ id: "o4", number: "LAF-SHP-2026-00004", email: "guest@example.com", total: 200, placedAt: "2026-11-14T03:00:00Z", status: "refunded", name: "Guest Buyer Again" }),
    ],
  );
  assert.deepEqual(rows.map((r) => r.key), ["c1", "c2", "guest:guest@example.com"], "two accounts, and one guest for two spellings of an address");
  const [one, two, guest] = rows;
  assert.deepEqual([one.state, one.orders, one.spent, one.lastOrderStatus, one.orderIds], ["active", 1, 450, "expired", ["o2", "o1"]], "an unpaid order that lapsed is not counted; only paid orders are money");
  assert.deepEqual([two.orders, two.spent, two.lastOrderAt, two.lastSignInAt], [0, 0, null, null], "an account that never ordered");
  assert.deepEqual([guest.state, guest.customerId, guest.name, guest.orders, guest.spent], ["guest", null, "Guest Buyer Again", 2, 500], "a refunded order is an order, but not money kept");
  assert.equal(guest.createdAt, "2026-11-12T03:00:00Z", "a guest is known since their first order");
  assert.deepEqual([one.gifts, one.given, one.lastGiftAt], [0, 0, null], "no gifts were passed in");
});

it("a closed account keeps its orders and shows no personal details", () => {
  const [row] = customerRows([cust({ status: "closed", email: "closed-c1@closed.invalid", name: "", phone: "", addressLine: "" })], [sale({ customerId: "c1", email: "one@example.com" })]);
  assert.deepEqual([row.state, row.name, row.email, row.orders], ["closed", "", "", 1]);
});

it("the page opens on customers with orders, latest order first; the other lists are the newest accounts and the latest donors", () => {
  assert.deepEqual(CUSTOMER_VIEWS.map((v) => v.key), ["with_orders", "new", "donors", "all"]);
  const rows = customerRows(
    [cust(), cust({ id: "c2", email: "two@example.com", createdAt: "2026-11-16T02:00:00Z", lastSignInAt: null }), cust({ id: "c3", email: "closed-c3@closed.invalid", status: "closed", createdAt: "2026-11-17T02:00:00Z" })],
    [sale({ id: "o1", customerId: "c1", placedAt: "2026-11-11T03:00:00Z" }), sale({ id: "o3", placedAt: "2026-11-14T03:00:00Z" })],
  );
  assert.deepEqual(customersIn(rows, "with_orders").map((r) => r.key), ["guest:guest@example.com", "c1"], "only those who ordered, latest order first");
  assert.deepEqual(customersIn(rows, "new").map((r) => r.key), ["c2", "c1"], "accounts by when they were made: no guests, no closed accounts");
  assert.deepEqual(customersIn(rows, "donors"), [], "nobody has given yet");
  assert.equal(customersIn(rows, "all").length, 4, "everyone, closed accounts too");
  assert.equal(customerViewDate(rows[0], "with_orders"), "2026-11-11T03:00:00Z");
  assert.equal(customerViewDate(rows[0], "new"), "2026-11-10T02:00:00Z");
  assert.equal(customerViewDate(rows[0], "all"), "2026-11-17T02:00:00Z", "the latest of order, sign-in and creation");
});

it("a customer is found by name, address, mobile number or order number", () => {
  const [row] = customerRows([], [sale()]);
  for (const term of ["guest buyer", "GUEST@EXAMPLE", "0918 111", "shp-2026-00001", "  "]) assert.equal(customerMatches(row, term), true, term);
  assert.equal(customerMatches(row, "nobody"), false);
});

it("the Customers page is registered, and its data hook never asks for a code or a session", () => {
  const pages = readFileSync(new URL("../lib/rbac/pages.ts", import.meta.url), "utf8");
  assert.match(pages, /p\("shop", "customers", "\/shop\/customers", "Customers"\)/);
  const hook = readFileSync(new URL("../lib/hooks/use-shop-collection.ts", import.meta.url), "utf8");
  assert.ok(!/customer_sessions|sign_in_codes|token_hash|code_hash/.test(hook), "the browser never reads sessions or codes");
  const sql = readFileSync(new URL("../supabase/migrations/0160_shop_customers.sql", import.meta.url), "utf8");
  assert.ok(!/grant[^;]*on shop\.(customer_sessions|sign_in_codes)[^;]*to authenticated/.test(sql), "staff get no grant on sessions or codes");
  assert.match(sql, /grant select on shop\.customers, shop\.customer_events to authenticated;/);
  assert.ok(!/auth\.users/.test(sql.replace(/--.*$/gm, "")), "a customer is never a Supabase sign-in");
});

// ---- Giving from the account (0161) ----
const gift = (over = {}) => ({ id: "g1", reference: "LAF-GFT-2026-00001", customerId: "c1", amount: 500, anonymous: false, status: "paid", createdAt: "2026-11-15T01:00:00Z", paidAt: "2026-11-15T01:05:00Z", payMethod: "gcash", payFee: 11.15, live: true, receiptNo: "LAF-CSH-2026-0001", attention: "", ...over });

it("a customer's gifts are counted when they were paid with real money, and never for a guest", () => {
  const rows = customerRows(
    [cust(), cust({ id: "c2", email: "two@example.com" })],
    [sale({ id: "o3" })],
    [
      gift(),
      gift({ id: "g2", amount: 1000.5, paidAt: "2026-11-17T04:00:00Z", anonymous: true }),
      gift({ id: "g3", amount: 300, live: false, receiptNo: "" }),
      gift({ id: "g4", amount: 700, status: "pending", paidAt: null, receiptNo: "" }),
      gift({ id: "g5", amount: 900, status: "expired", paidAt: null, receiptNo: "" }),
    ],
  );
  const [one, two, guest] = rows;
  assert.deepEqual([one.gifts, one.given, one.lastGiftAt], [2, 1500.5, "2026-11-17T04:00:00Z"], "a test payment, an unpaid gift and a lapsed one are not gifts");
  assert.deepEqual([two.gifts, two.given, two.lastGiftAt], [0, 0, null]);
  assert.deepEqual([guest.gifts, guest.given], [0, 0], "giving needs an account");
  assert.deepEqual(customersIn(rows, "donors").map((r) => r.key), ["c1"], "Latest donors lists who gave");
  assert.equal(customerViewDate(one, "donors"), "2026-11-17T04:00:00Z", "by their latest gift");
  assert.equal(isGiven(gift({ live: false })), false);
  assert.equal(isGiven(gift({ status: "pending" })), false);
});

it("the Giving card of Shop settings reads up to six amounts between the smallest and the largest gift", () => {
  assert.deepEqual(readGiving(["500", "200", "", "1,000", "₱2,500", ""], "100", "50,000"), { ok: true, amounts: [200, 500, 1000, 2500], min: 100, max: 50000 }, "sorted, empty boxes left out");
  assert.deepEqual(readGiving(["500", "500"], "100", "500"), { ok: true, amounts: [500], min: 100, max: 500 }, "the same amount twice is one amount");
  for (const [boxes, min, max, why] of [
    [["", ""], "100", "50000", "no amount"],
    [["abc"], "100", "50000", "not an amount"],
    [["50"], "100", "50000", "below the smallest"],
    [["60000"], "100", "50000", "above the largest"],
    [["500"], "0", "50000", "a smallest gift of nothing"],
    [["500"], "600", "500", "the largest below the smallest"],
    [["500"], "100", "2000000", "more than the database allows"],
    [["100", "200", "300", "400", "500", "600", "700"], "100", "50000", "seven amounts"],
  ]) assert.equal(readGiving(boxes, min, max).ok, false, why);
});

it("gifts (0161): the site reads no table, a test payment never reaches Donors, and staff only read", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0161_shop_gifts.sql", import.meta.url), "utf8");
  const code = sql.replace(/--.*$/gm, "");
  assert.match(sql, /grant select on shop\.gifts to authenticated;/);
  assert.ok(!/grant (insert|update|delete|all)[^;]*on shop\.gifts[^;]*to authenticated/.test(code), "nobody writes a gift from the browser");
  assert.ok(!/grant[^;]*on (table )?(shop\.gifts|ops\.[a-z_]+)[^;]*to shop_web/.test(code.replace(/grant execute on function[^;]+;/g, "")), "the site's login gets no table, in the shop or in Donors");
  // The one place a donation is written checks that the payment was a live one, first.
  assert.match(code, /if not found or g\.status <> 'paid' or not g\.live or g\.receipt_no is not null then return null; end if;/);
  assert.equal(code.split("insert into ops.donations").length - 1, 1, "one place writes a donation");
  assert.equal(code.split("ops.next_doc_number('LAF-CSH'").length - 1, 1, "one place takes a receipt number");
  for (const fn of ["gift_to_donors", "gifts_sweep"]) assert.ok(!new RegExp(`grant execute on function shop\\.${fn}\\(`).test(code), `${fn} is nobody's to call`);
  assert.match(code, /live = coalesce\(p_live, false\)/, "a payment is a test unless the site says it was live");
  // An online gift stays out of the automatic matching to deposits (both steps that look at deposits).
  assert.equal(code.split("g.payment_method is distinct from 'online'").length - 1, 2);
  assert.match(code, /'other', 'online'\)\);/, "the register takes the online method");
  assert.ok(!/auth\.users/.test(code), "a customer is never a Supabase sign-in");
  const hook = readFileSync(new URL("../lib/hooks/use-shop-collection.ts", import.meta.url), "utf8");
  assert.ok(!/from\("gifts"\)\.(insert|update|delete|upsert)/.test(hook), "the browser only reads gifts");
  const labels = readFileSync(new URL("../lib/utils/cash-gifts.ts", import.meta.url), "utf8") + readFileSync(new URL("../lib/pdf/cash-ar.ts", import.meta.url), "utf8");
  assert.equal(labels.split('online: "Online payment"').length - 1, 2, "Donors and the receipt both name the online method");
});

it("closing an account also clears the wording of its trail, which could hold an earlier address (0162)", () => {
  const code = readFileSync(new URL("../supabase/migrations/0162_shop_close_clears_trail.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.match(code, /update shop\.customer_events set detail = null where customer_id = p_customer and detail is not null;/);
  assert.match(code, /update shop\.customer_events e set detail = null\s+from shop\.customers c\s+where c\.id = e\.customer_id and c\.status = 'closed'/, "accounts closed earlier are cleared too");
  assert.ok(!/grant execute on function shop\.customer_close/.test(code), "closing stays an inside step: nobody calls it directly");
  assert.ok(!/delete from shop\.(orders|gifts)|update shop\.(orders|gifts)/.test(code), "orders and gifts, the foundation's records, are not touched");
});
