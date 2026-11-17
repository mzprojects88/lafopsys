// The 0158 pre-flight (the Shop sales card on the dashboard), on the development database and ALWAYS rolled back.
//   node --env-file=.env.local scripts/rls/shop-dashboard-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";
import { seedShopAccess } from "./shop-access-seed.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
const check = (name, good, extra = "") => { if (good) pass++; else fail++; console.log(`${good ? "PASS" : "FAIL"}  ${name}${good ? "" : `  ${extra}`}`); };
const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];
/** Runs one statement as a staff member, then goes back to the owner. */
async function as(staffId, sql, params = []) {
  await c.query("savepoint s");
  let r;
  try {
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: staffId, role: "authenticated" })]);
    await c.query("set local role authenticated");
    await c.query("discard plans");
    r = { ok: true, rows: (await c.query(sql, params)).rows };
  } catch (e) {
    r = { ok: false, error: e.message, code: e.code };
  }
  await c.query("rollback to savepoint s");
  await c.query("reset role");
  return r;
}

try {
  await c.query("begin");
  // The card's rule comes first (the seed below needs it), then the Shop's role and levels, which development
  // does not keep (see shop-access-seed.mjs), then the file again as production will run it: after the role exists.
  await c.query(readFileSync(new URL("../../supabase/migrations/0158_shop_dashboard_card.sql", import.meta.url), "utf8"));
  await seedShopAccess(c);
  await c.query(readFileSync(new URL("../../supabase/migrations/0158_shop_dashboard_card.sql", import.meta.url), "utf8"));
  const ids = await one(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin,
    (select id from shared.staff where role = 'finance' and active order by id limit 1) finance,
    (select id from shared.staff where role = 'driver' and active order by id limit 1) driver`);
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);

  const rows = await one(`select array_agg(role order by role) roles from shared.role_dashboard_cards where card = 'shop'`);
  check("the Shop sales card is given to the CEO, Finance and the Shop Admin", JSON.stringify(rows.roles) === JSON.stringify(["ceo", "finance", "shop_admin"]), JSON.stringify(rows));
  check("running the file twice adds nothing", (await one(`select count(*)::int n from shared.role_dashboard_cards where card = 'shop'`)).n === 3);
  let r = await as(ids.finance, `select shared.dashboard_card_ok('shop') ok`);
  check("Finance's profile has the card", r.ok && r.rows[0].ok === true, JSON.stringify(r));
  r = await as(ids.driver, `select shared.dashboard_card_ok('shop') ok`);
  check("a driver's profile does not", r.ok && r.rows[0].ok === false, JSON.stringify(r));
  r = await as(ids.admin, `select shared.dashboard_card_ok('shop') ok`);
  check("the Super Admin has every card", r.ok && r.rows[0].ok === true, JSON.stringify(r));
  r = await as(ids.driver, `select count(*)::int n from shop.orders`);
  check("and whatever a profile says, a driver reads no shop order", r.ok && r.rows[0].n === 0, JSON.stringify(r));
  r = await as(ids.finance, `select count(*)::int n from shop.orders`);
  check("Finance reads the orders the card counts", r.ok && r.rows[0].n > 0, JSON.stringify(r));
  // Shop Admin as an added task: an extra role on someone who keeps their own role.
  await c.query(`update shared.staff set extra_roles = array['shop_admin'] where id = $1`, [ids.driver]);
  r = await as(ids.driver, `select shared.module_editable('shop') edit, shared.dashboard_card_ok('shop') card, (select count(*)::int from shop.orders) orders`);
  check("a driver given Shop Admin as an extra role works in the Shop and has its card", r.ok && r.rows[0].edit === true && r.rows[0].card === true && r.rows[0].orders > 0, JSON.stringify(r));
  await c.query(`update shared.staff set extra_roles = '{}' where id = $1`, [ids.driver]);
  r = await as(ids.driver, `select shared.module_editable('shop') edit`);
  check("and loses it when the extra role is taken away", r.ok && r.rows[0].edit === false, JSON.stringify(r));
  r = await as(ids.admin, `insert into shared.role_dashboard_cards (role, card) values ('driver', 'not_a_card')`);
  check("a card the catalogue does not know is still refused", !r.ok && r.code === "23514", JSON.stringify(r));
  check("every earlier card is still allowed", (await one(`select count(*)::int n from shared.role_dashboard_cards where card <> 'shop'`)).n > 100);
} catch (e) {
  fail++;
  console.log("STOPPED:", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
