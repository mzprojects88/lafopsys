// The 0150 pre-flight (report profiles and the new report sections), on the development database and ALWAYS rolled
// back: who reads and designs profiles, who gets the occupancy and expense figures, and the retired page row.
//   node --env-file=.env.local scripts/rls/report-profiles-matrix.mjs
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
const n = (want) => (r) => r.ok && r.rows[0].n === want;

try {
  await c.query("begin");
  await c.query(readFileSync(new URL("../../supabase/migrations/0150_report_profiles.sql", import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where active and role = 'admin' order by id limit 1) admin,
    (select id from shared.staff where active and role = 'finance' and not ('admin' = any(extra_roles)) limit 1) finance,
    (select id from shared.staff where active and role = 'social_worker' and extra_roles = '{}' limit 1) sw,
    (select id from shared.staff where active and role = 'driver' and extra_roles = '{}' limit 1) driver`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);
  const reportsFor = async (id) => (await c.query("select (select shared.module_level('reports')) l from (select set_config('request.jwt.claims', $1, true)) x", [JSON.stringify({ sub: id, role: "authenticated" })])).rows[0].l;
  const swReports = await reportsFor(ids.sw);
  const driverReports = await reportsFor(ids.driver);
  const withReports = ["view", "edit"].includes(swReports) ? ids.sw : null;
  const without = !["view", "edit"].includes(driverReports) ? ids.driver : null;
  console.log(`(fixtures: social worker reports=${swReports}, driver reports=${driverReports})`);

  await step("the five starter profiles", null, "select count(*)::int n from ops.report_profiles where built_in", [], n(5));
  await step("the One Child starter limits to the OC fund and has only the fund's spending", null, "select count(*)::int n from ops.report_profiles where name = 'One Child report' and fund_code = 'OC' and sections = '{expenses}'", [], n(1));
  await step("Finance designs a profile", ids.finance, "insert into ops.report_profiles (name, sections) values ('Test profile', '{housing}') returning id", [], (r) => r.ok);
  await step("... signed and stamped", null, "select count(*)::int n from ops.report_profiles where name = 'Test profile' and updated_by = $1", [ids.finance], n(1));
  await step("the Super Admin changes it", ids.admin, "update ops.report_profiles set description = 'changed' where name = 'Test profile'", [], (r) => r.ok && r.n === 1);
  await step("the social worker can't design one", ids.sw, "insert into ops.report_profiles (name, sections) values ('Mine', '{housing}')", [], refused("42501"), false);
  await step("... nor change one", ids.sw, "update ops.report_profiles set description = 'x' where name = 'Test profile'", [], (r) => r.ok && r.n === 0, false);
  await step("an unknown comparison is refused", null, "insert into ops.report_profiles (name, sections, comparisons) values ('Bad', '{housing}', '{last_year}')", [], refused("23514"), false);
  if (withReports) await step("someone with Reports reads the profiles", withReports, "select count(*)::int n from ops.report_profiles where built_in", [], n(5));
  if (without) {
    await step("someone without Reports reads none", without, "select count(*)::int n from ops.report_profiles", [], n(0));
    await step("... and gets no report figures", without, "select ops.report_extra('2026-10-01', '2026-10-31')", [], refused("42501"), false);
  }
  await step("Finance gets occupancy and expenses with the budget", ids.finance, "select ops.report_extra('2026-10-01', '2026-10-31') r", [], (r) => r.ok && r.rows[0].r.occupancy.beds > 0 && "expenses" in r.rows[0].r && "budget" in r.rows[0].r.expenses);
  await step("... all active beds, with the regular ones apart", ids.finance, "select (ops.report_extra('2026-10-01', '2026-10-31')->'occupancy') o", [], (r) => r.ok && r.rows[0].o.beds >= r.rows[0].o.regular_beds);
  if (withReports) await step("the social worker gets occupancy but no expenses", withReports, "select ops.report_extra('2026-10-01', '2026-10-31') r", [], (r) => r.ok && "occupancy" in r.rows[0].r && !("expenses" in r.rows[0].r));
  await step("a range over ten years is refused", ids.finance, "select ops.report_extra('2000-01-01', '2026-01-01')", [], refused("22023"), false);
  await step("nights ahead aren't counted", ids.finance, "select (ops.report_extra((now() at time zone 'Asia/Manila')::date + 1, (now() at time zone 'Asia/Manila')::date + 30)->'occupancy'->>'family_nights')::int n", [], n(0));
  await step("tonight counts only once finalized in the app (never from the House Sheet)", ids.finance,
    "select (ops.report_extra(d, d)->'occupancy'->>'family_nights')::int = (select count(distinct s.patient_id) from ops.bed_nights b join ops.stays s on s.id = b.stay_id where b.night = d)::int ok from (select (now() at time zone 'Asia/Manila')::date d) x", [], (r) => r.ok && r.rows[0].ok === true);
  await step("the Executive summary keeps its comparison tables (YTD and goals)", null, "select count(*)::int n from ops.report_profiles where name = 'Executive summary' and not (charts::text like '%figures%')", [], n(1));
  // The budget needs the Budget card too: Finance without it gets the expenses but no budget line.
  await c.query("delete from shared.role_dashboard_cards where role = 'finance' and card = 'budget'");
  await step("Expenses without the Budget card: no budget figure", ids.finance, "select ops.report_extra('2026-10-01', '2026-10-31')->'expenses' e", [], (r) => r.ok && r.rows[0].e && r.rows[0].e.budget === null);
  await step("the Report generator page row is retired", null, "select count(*)::int n from shared.role_page_access where page = 'reports.generate'", [], n(0));
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
