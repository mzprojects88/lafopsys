// The 0137 + 0145 pre-flight (goals and budgets), on the development database and ALWAYS rolled back: applies the
// migration in a transaction and proves who reads and writes goals, who keys in, approves and revises budgets, and
// that an approved budget is locked.
//   node --env-file=.env.local scripts/rls/budget-matrix.mjs
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
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `rows=${r.n} ${JSON.stringify(r.rows?.[0] ?? "").slice(0, 100)}` : `${r.code} ${r.error.slice(0, 110)}`}`);
  return r;
}
const refused = (code) => (r) => !r.ok && (!code || r.code === code);
const val = (r) => (r.ok ? Object.values(r.rows[0])[0] : undefined);

try {
  await c.query("begin");
  for (const m of ["0137_budgets_goals.sql", "0145_budget_copy.sql"]) await c.query(readFileSync(new URL(`../../supabase/migrations/${m}`, import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where active and role = 'admin' and 'ceo' = any(extra_roles) limit 1) ceo,
    (select id from shared.staff where active and role = 'admin' and not ('ceo' = any(extra_roles)) limit 1) admin,
    (select id from shared.staff where active and role = 'finance' limit 1) finance,
    (select id from shared.staff where active and role = 'social_worker' limit 1) sw,
    (select id from shared.staff where active and role = 'driver' limit 1) driver`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);
  const hsg = (await c.query(`select md5('code:T3:HSG')::uuid id`)).rows[0].id;

  // Goals.
  const g = val(await step("the CEO sets a 3-year goal", ids.ceo, `insert into ops.goals (title, horizon, start_year, program_id, measure) values ('House more families', 3, 2027, 'prog-housing', 'housing') returning id`, [], (r) => r.ok));
  await step("... with yearly targets", ids.ceo, `insert into ops.goal_targets (goal_id, year, target) values ($1, 2027, 4000), ($1, 2028, 4500), ($1, 2029, 5000)`, [g], (r) => r.ok && r.n === 3);
  await step("Finance can't read the goals", ids.finance, `select count(*)::int n from ops.goals`, [], (r) => r.ok && r.rows[0].n === 0);
  await step("a social worker can't read the goals", ids.sw, `select count(*)::int n from ops.goal_targets`, [], (r) => r.ok && r.rows[0].n === 0);
  await step("Finance can't write a goal", ids.finance, `insert into ops.goals (title, horizon, start_year) values ('x', 1, 2027)`, [], refused("42501"), false);
  await step("the Super Admin reads and edits goals", ids.admin, `update ops.goals set narrative = 'Three more rooms' where id = $1 returning id`, [g], (r) => r.ok && r.n === 1);

  // Budgets.
  const b = val(await step("Finance starts a test year's budget (2091; real years stay untouched) (a draft)", ids.finance, `insert into ops.budgets (year) values (2091) returning id`, [], (r) => r.ok));
  await step("only one draft a year", ids.finance, `insert into ops.budgets (year, version) values (2091, 2)`, [], refused("23505"), false);
  await step("Finance can't insert an approved budget", ids.finance, `insert into ops.budgets (year, version, status, approved_at) values (2092, 1, 'approved', now())`, [], refused("42501"), false);
  const item = val(await step("Finance adds an item: Housing, patients and carers housed", ids.finance, `insert into ops.budget_items (budget_id, t3_id, label, unit, measure) values ($1, $2, 'Patients and carers housed', 'people-nights', 'housing') returning id`, [b, hsg], (r) => r.ok));
  await step("... with quantity and amount per month", ids.finance, `insert into ops.budget_values (item_id, month, quantity, amount) select $1, m, 300, 45000 from generate_series(1, 12) m`, [item], (r) => r.ok && r.n === 12);
  await step("a driver can't read budgets", ids.driver, `select count(*)::int n from ops.budgets`, [], (r) => r.ok && r.rows[0].n === 0);
  await step("Finance can't approve", ids.finance, `select ops.budget_approve($1)`, [b], refused("42501"), false);
  await step("the Super Admin (not the CEO) can't approve", ids.admin, `select ops.budget_approve($1)`, [b], refused("42501"), false);
  await step("the CEO approves", ids.ceo, `select ops.budget_approve($1)`, [b], (r) => r.ok);
  await step("an approved budget's figures are locked", ids.finance, `update ops.budget_values set amount = 1 where item_id = $1`, [item], (r) => r.ok && r.n === 0);
  await step("... and its items", ids.ceo, `delete from ops.budget_items where id = $1`, [item], (r) => r.ok && r.n === 0);
  await step("... and it can't be put back to draft", ids.finance, `update ops.budgets set status = 'draft', approved_at = null where id = $1`, [b], (r) => r.ok && r.n === 0);
  await step("a revision needs a reason", ids.finance, `select ops.budget_revise($1, ' ')`, [b], refused("23514"), false);
  const rev = val(await step("Finance revises with a reason: a new draft version, copied", ids.finance, `select ops.budget_revise($1, 'Care Cart grows in March') id`, [b], (r) => r.ok));
  await step("... version 2 holds the copied item and its 12 months", null, `select b.version, (select count(*)::int from ops.budget_values v join ops.budget_items i on i.id = v.item_id where i.budget_id = b.id) n from ops.budgets b where b.id = $1`, [rev], (r) => r.ok && r.rows[0].version === 2 && r.rows[0].n === 12);
  await step("the CEO approves the revision: version 1 is superseded", ids.ceo, `select ops.budget_approve($1)`, [rev], (r) => r.ok);
  await step("... one approved version stands for 2027", null, `select string_agg(version || '=' || status, ',' order by version) s from ops.budgets where year = 2091`, [], (r) => r.ok && r.rows[0].s === "1=superseded,2=approved");
  // Saving in one step (code review, 12 Nov): all of an item or a goal, or none of it.
  const months = (amount) => JSON.stringify(Array.from({ length: 12 }, (_, m) => ({ quantity: 10, amount: m === 5 ? amount : 100 })));
  const d3 = val(await step("Finance starts 2028", ids.finance, `insert into ops.budgets (year) values (2092) returning id`, [], (r) => r.ok));
  await step("an item with a negative month is refused whole: no item left behind", ids.finance,
    `select ops.budget_save_item(null, $1::jsonb, $2::jsonb)`, [JSON.stringify({ budget_id: d3, t3_id: hsg, label: "Meals", measure: "meals" }), months(-5)], refused("23514"), false);
  await step("... the draft still has no items", null, `select count(*)::int n from ops.budget_items where budget_id = $1`, [d3], (r) => r.ok && r.rows[0].n === 0);
  const it3 = val(await step("a good item is saved with its 12 months at once", ids.finance,
    `select ops.budget_save_item(null, $1::jsonb, $2::jsonb) id`, [JSON.stringify({ budget_id: d3, t3_id: hsg, label: "Meals", measure: "meals" }), months(100)], (r) => r.ok));
  await step("... 12 months stored", null, `select count(*)::int n from ops.budget_values where item_id = $1`, [it3], (r) => r.ok && r.rows[0].n === 12);
  await step("an approved budget's item can't be saved through the function either", ids.finance,
    `select ops.budget_save_item(null, $1::jsonb, $2::jsonb)`, [JSON.stringify({ budget_id: rev, label: "Late item" }), months(100)], refused("23514"), false);
  await step("a driver can't save an item", ids.driver, `select ops.budget_save_item(null, $1::jsonb, $2::jsonb)`, [JSON.stringify({ budget_id: d3, label: "x" }), months(1)], refused("42501"), false);
  await step("Finance can't save a goal through the function", ids.finance, `select ops.goal_save(null, '{"title":"x","horizon":1,"start_year":2027}'::jsonb, '[]'::jsonb)`, [], refused("42501"), false);
  await step("the CEO saves a goal and its targets at once; a bad target refuses all of it", ids.ceo,
    `select ops.goal_save($1, '{"title":"House more families","horizon":3,"start_year":2027,"program_id":"prog-housing","measure":"housing"}'::jsonb, '[{"year":2027,"target":-1}]'::jsonb)`, [g], refused("23514"), false);
  await step("... the earlier targets are still there", null, `select count(*)::int n from ops.goal_targets where goal_id = $1`, [g], (r) => r.ok && r.rows[0].n === 3);
  // 0145: a new year starts from an earlier year's approved budget.
  await step("a driver can't copy a budget", ids.driver, `select ops.budget_copy($1, 2094)`, [rev], refused("42501"), false);
  await step("a draft can't be copied", ids.finance, `select ops.budget_copy($1, 2094)`, [d3], refused("23514"), false);
  await step("nor into an earlier year", ids.finance, `select ops.budget_copy($1, 2090)`, [rev], refused("23514"), false);
  await step("nor into a year already started", ids.finance, `select ops.budget_copy($1, 2092)`, [rev], refused("23514"), false);
  const cp = val(await step("Finance starts 2030 from 2027's approved budget", ids.finance, `select ops.budget_copy($1, 2094) id`, [rev], (r) => r.ok));
  await step("... a draft with the same items and their 12 months", null,
    `select b.status, b.version, (select count(*)::int from ops.budget_items where budget_id = b.id) items, (select count(*)::int from ops.budget_values v join ops.budget_items i on i.id = v.item_id where i.budget_id = b.id) months,
            (select count(*)::int from ops.budget_items where budget_id = $2) source_items from ops.budgets b where b.id = $1`, [cp, rev],
    (r) => r.ok && r.rows[0].status === "draft" && r.rows[0].version === 1 && r.rows[0].items === r.rows[0].source_items && r.rows[0].months === r.rows[0].items * 12);
  await step("the due-date settings default to 31 December, 30 days' notice", null, `select budget_due_month, budget_due_day, budget_remind_days from ops.finance_settings`, [], (r) => r.ok && r.rows[0].budget_due_month === 12 && r.rows[0].budget_due_day === 31 && r.rows[0].budget_remind_days === 30);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
