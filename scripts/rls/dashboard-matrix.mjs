// The 0147 pre-flight (dashboard profiles), on the development database and ALWAYS rolled back: applies the
// migration in a transaction and proves who gets which figures, that layouts are each person's own, that only the
// Super Admin sets profiles, and that the program totals equal the website feed's.
//   node --env-file=.env.local scripts/rls/dashboard-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
async function step(name, who, sql, params, expect, keep = true) {
  await c.query("savepoint s");
  let r;
  try {
    if (who) {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who, role: "authenticated" })]);
      await c.query("set local role authenticated");
      await c.query("discard plans");
    }
    const q = await c.query(sql, params);
    r = { ok: true, rows: q.rows, n: q.rowCount };
  } catch (e) {
    r = { ok: false, error: e.message, code: e.code };
  }
  if (!r.ok || !keep) await c.query("rollback to savepoint s");
  await c.query("reset role");
  if (r.ok && keep) await c.query("release savepoint s");
  const good = expect(r);
  if (good) pass++;
  else fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `rows=${r.n} ${JSON.stringify(r.rows?.[0] ?? "").slice(0, 110)}` : `${r.code} ${r.error.slice(0, 120)}`}`);
  return r;
}
const refused = (code) => (r) => !r.ok && (!code || r.code === code);
const one = async (sql, params = []) => Object.values((await c.query(sql, params)).rows[0])[0];
const n = (want) => (r) => r.ok && r.rows[0].n === want;

try {
  await c.query("begin");
  await c.query(readFileSync(new URL("../../supabase/migrations/0147_dashboard_profiles.sql", import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where active and role = 'admin' order by id limit 1) admin,
    (select id from shared.staff where active and role = 'finance' and not ('admin' = any(extra_roles)) limit 1) finance,
    (select id from shared.staff where active and role = 'driver' and extra_roles = '{}' and not is_hr limit 1) driver,
    (select id from shared.staff where active and role = 'social_worker' and extra_roles = '{}' and not is_hr limit 1) sw`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);
  const fig = "select ops.dashboard_figures('2026-01-01', current_date) r";

  await step("profiles: the program cards for the driver", null, `select count(*)::int n from shared.role_dashboard_cards where role = 'driver' and card in ('housing', 'rides', 'meals', 'child_visits', 'care_cart', 'patients')`, [], n(6));
  await step("... the money cards only for Office Admin, Finance, the CEO and the Trustees", null,
    `select count(*)::int n from shared.role_dashboard_cards where card = 'cash'`, [], n(4));
  await step("the driver gets the program figures", ids.driver, fig, [], (r) => r.ok && r.rows[0].r.lines.housing > 0 && r.rows[0].r.unique_patients > 0);
  await step("... and no money figure at all", ids.driver, fig, [], (r) => r.ok && !("cash" in r.rows[0].r) && !("expenses" in r.rows[0].r) && !("gifts" in r.rows[0].r) && !("budget" in r.rows[0].r));
  await step("Finance gets cash, gifts, expenses and the budget", ids.finance, fig, [], (r) => r.ok && ["cash", "gifts", "expenses", "budget"].every((k) => k in r.rows[0].r));
  await step("the Super Admin too", ids.admin, fig, [], (r) => r.ok && "cash" in r.rows[0].r);
  const site = await one(`select ops.website_dashboard()->'ytd' r`);
  await step("the year's housing, meals and Care Cart equal the website feed's", ids.driver,
    `select ops.dashboard_figures(make_date(extract(year from now() at time zone 'Asia/Manila')::int, 1, 1), (now() at time zone 'Asia/Manila')::date)->'lines' r`, [],
    (r) => r.ok && Number(r.rows[0].r.housing) === Number(site.housing) && Number(r.rows[0].r.meals_breakfast) + Number(r.rows[0].r.meals_lunch) + Number(r.rows[0].r.meals_dinner) === Number(site.meals)
      && ["care_cart_1000", "care_cart_1200", "care_cart_1700"].reduce((t, k) => t + Number(r.rows[0].r[k] ?? 0), 0) === Number(site.care_cart));
  await step("a range over ten years is refused", ids.driver, "select ops.dashboard_figures('2000-01-01', '2026-01-01')", [], refused("22023"), false);
  await c.query("select set_config('request.jwt.claims', '', true)");
  await step("signed out: refused", null, "select ops.dashboard_figures('2026-01-01', '2026-02-01')", [], refused("42501"), false);

  await step("the driver can't change a profile", ids.driver, "insert into shared.role_dashboard_cards (role, card) values ('driver', 'cash')", [], refused("42501"), false);
  await step("the Super Admin gives the driver the cash card", ids.admin, "insert into shared.role_dashboard_cards (role, card) values ('driver', 'cash')", [], (r) => r.ok);
  await step("... and the driver now gets cash, still not expenses", ids.driver, fig, [], (r) => r.ok && "cash" in r.rows[0].r && !("expenses" in r.rows[0].r));
  await step("no profile rows for the Super Admin role itself", ids.admin, "insert into shared.role_dashboard_cards (role, card) values ('admin', 'cash')", [], refused("42501"), false);

  await step("the driver saves their own layout", ids.driver, "insert into shared.dashboard_layouts (cards, actions, period) values ('{meals,housing}', '{new_trip}', 'today')", [], (r) => r.ok);
  await step("... and reads it back", ids.driver, "select count(*)::int n from shared.dashboard_layouts where staff_id = $1 and period = 'today'", [ids.driver], n(1));
  await step("the social worker can't read it", ids.sw, "select count(*)::int n from shared.dashboard_layouts where staff_id = $1", [ids.driver], n(0));
  await step("... nor write one for the driver", ids.sw, "insert into shared.dashboard_layouts (staff_id, cards) values ($1, '{}')", [ids.driver], refused("42501"), false);
  await step("an unknown period is refused", ids.sw, "insert into shared.dashboard_layouts (period) values ('forever')", [], refused("23514"), false);
  await step("New Cash Entry has left every role", null, "select count(*)::int n from shared.role_page_access where page = 'finance.entry'", [], n(0));
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`
${pass} passed, ${fail} failed (rolled back)`);
}
