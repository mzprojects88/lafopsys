// Proves 0090 (outside / partner accounts) against the live database: signed in as a
// 'partner_viewer', a person reads NOTHING and writes NOTHING anywhere -- every table and view
// of every schema is swept, not a hand-picked list -- except her own staff row (read, and the
// PIN flag), and what the access grid gives the Inventory partner functions (laf-inventory 0063,
// checked when present). One transaction, rolled back; a test account borrows the role.
//
// Usage:      RLS_ALLOW_PROD=1 node --env-file=.env.local scripts/rls/partner-matrix.mjs
// Pre-flight: ... partner-matrix.mjs supabase/migrations/0090_partner_accounts.sql [more.sql]
//   (applies the files inside the same rolled-back transaction. That holds an exclusive lock on
//   shared.staff for the whole run: dev only, never production -- apply there, then run plain.)
import { pgUrl } from "../lib/db-url.mjs";
import { Client } from "pg";
import { readFile } from "node:fs/promises";

if (process.env.RLS_ALLOW_PROD !== "1") {
  console.error("This targets the live database (one rolled-back transaction). Set RLS_ALLOW_PROD=1 to run.");
  process.exit(1);
}
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}
const client = new Client({ connectionString: pgUrl(password) });
const files = process.argv.slice(2);
const results = [];
const notes = [];
const full = [];
const record = (scenario, ok, detail = "") => results.push({ scenario, result: ok ? "PASS" : "FAIL", detail: String(detail).replace(/\s+/g, " ").slice(0, 110) });
const q = (sql, params) => client.query(sql, params);
const claims = (id) => JSON.stringify({ sub: id, role: "authenticated" });

/** Runs one statement inside a savepoint, so a refusal never aborts the sweep. */
async function attempt(sql, params) {
  await q("savepoint s");
  try {
    const r = await q(sql, params);
    await q("rollback to savepoint s");
    return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) {
    await q("rollback to savepoint s");
    return { ok: false, code: e.code, message: e.message };
  }
}
async function as(id) {
  await q("reset role");
  await q("select set_config('request.jwt.claims', $1, true)", [claims(id)]);
  await q("set local role authenticated");
  await q("discard plans"); // a plan cached as postgres would skip the policies (0051 lesson)
}

await client.connect();
try {
  await q("begin");
  await q("set local lock_timeout = '5s'");
  await q("set local statement_timeout = '60s'");
  await q("set local idle_in_transaction_session_timeout = '120s'");
  for (const f of files) await q(await readFile(f, "utf8"));

  const { rows: spare } = await q(`select id from shared.staff where staff_code like 'RLSTEST-%' and role <> 'admin' order by created_at limit 1`);
  const { rows: admin } = await q(`select id from shared.staff where role = 'admin' and active order by created_at limit 1`);
  if (!spare[0] || !admin[0]) throw new Error("Needs an RLSTEST-% test account and an active admin.");
  const me = spare[0].id;
  await q(`update shared.staff set role = 'partner_viewer', extra_roles = '{}', is_hr = false, active = true, must_change_pin = true where id = $1`, [me]);

  // ---- what exists (listed as postgres). The sweeps run server-side, one statement each:
  // a round trip per table took minutes and held the pre-flight's locks that long. ----
  await q(
    `create temp table sweep_rels on commit drop as
     select n.nspname as s, c.relname as r, c.relkind as k,
            (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum limit 1) as col
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm') and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_(temp|toast)'`
  );
  await q("create temp table sweep_out (kind text, rel text, detail text) on commit drop");
  await q("grant select on sweep_rels to authenticated");
  await q("grant select, insert on sweep_out to authenticated");
  const relCount = (await q("select count(*)::int as n from sweep_rels")).rows[0].n;

  // ---- 1. the same helpers, for everyone else ----
  await as(admin[0].id);
  const a = (await q("select shared.current_staff_role() as r, shared.is_partner() as p, shared.has_role('admin') as h")).rows[0];
  record("an admin is still an admin, not a partner", a.r === "admin" && a.p === false && a.h === true, JSON.stringify(a));

  // ---- 2. as the partner ----
  await as(me);
  const who = (await q("select shared.current_staff_role() as r, cardinality(coalesce(shared.current_staff_roles(), '{}')) as n, shared.is_partner() as p, shared.module_level('inventory') as m, shared.has_role('partner_viewer') as h")).rows[0];
  record("partner: no staff role, no module level, is_partner", who.r === null && who.n === 0 && who.p === true && who.m === "none" && who.h === false, JSON.stringify(who));

  await q("set local statement_timeout = '300s'");
  await q(`do $sweep$
    declare t record; n bigint;
    begin
      for t in select * from sweep_rels loop
        begin
          execute format('select count(*) from %I.%I', t.s, t.r) into n;
          if n > 0 then insert into sweep_out values ('read', t.s || '.' || t.r, n::text); end if;
        exception when others then null; -- refused: what we want
        end;
      end loop;
    end $sweep$`);
  // Every change is tried inside a block that is always rolled back (P0999 carries the row count
  // out). Row security is checked before any constraint, so a constraint error on the empty
  // insert means the policy let her in.
  await q(`do $sweep$
    declare t record; n bigint; c text; col text;
    begin
      for t in select * from sweep_rels where k in ('r', 'p') and not (s = 'shared' and r = 'staff') loop
        begin
          execute format('delete from %I.%I', t.s, t.r); get diagnostics n = row_count;
          raise exception using errcode = 'P0999', message = n::text;
        exception when sqlstate 'P0999' then if sqlerrm::bigint > 0 then insert into sweep_out values ('delete', t.s || '.' || t.r, sqlerrm); end if;
                  when others then null;
        end;
        if t.col is not null then
          begin
            execute format('update %I.%I set %I = %I', t.s, t.r, t.col, t.col); get diagnostics n = row_count;
            raise exception using errcode = 'P0999', message = n::text;
          exception when sqlstate 'P0999' then if sqlerrm::bigint > 0 then insert into sweep_out values ('update', t.s || '.' || t.r, sqlerrm); end if;
                    when others then null;
          end;
        end if;
        begin
          execute format('insert into %I.%I default values', t.s, t.r);
          raise exception using errcode = 'P0999', message = 'accepted';
        exception when sqlstate 'P0999' then insert into sweep_out values ('insert', t.s || '.' || t.r, 'accepted');
                  when not_null_violation or foreign_key_violation or unique_violation or check_violation then
                    -- A guard trigger raising 23514 fires before row security and names no constraint or
                    -- column; a real constraint error names one, and means the policy let her in.
                    get stacked diagnostics c = constraint_name, col = column_name;
                    if c <> '' or col <> '' then insert into sweep_out values ('insert', t.s || '.' || t.r, 'past the policy: ' || sqlstate || ' ' || c || col); end if;
                  when others then null;
        end;
      end loop;
    end $sweep$`);
  // The verdict is on what an account can reach: the schemas the API serves (pgrst.db_schemas),
  // the staging twin and storage. Anything else the bare database role could touch (platform
  // extension tables) is printed below as a note; no API door leads there.
  const SERVED = ["public", "ops", "shared", "hr", "inventory", "inventory_staging", "storage"];
  const all = (await q("select kind, rel, detail from sweep_out order by 1, 2")).rows;
  const swept = all.filter((x) => SERVED.includes(x.rel.split(".")[0]));
  notes.push(...all.filter((x) => !swept.includes(x)).map((x) => `${x.kind} ${x.rel} (${x.detail})`));
  full.push(...swept.map((x) => `${x.kind} ${x.rel} (${x.detail})`));
  const readable = swept.filter((x) => x.kind === "read").map((x) => `${x.rel}=${x.detail}`);
  record(`partner reads no row of ${relCount} tables and views, but her own staff row`, readable.length === 1 && readable[0] === "shared.staff=1", readable.join(", ") || "nothing at all");
  const writable = swept.filter((x) => x.kind !== "read").map((x) => `${x.kind} ${x.rel} (${x.detail})`);
  record("partner changes no row anywhere (delete, update, insert on every table)", writable.length === 0, writable.join(", "));

  // ---- 3. the doors that answer "any staff" ----
  const { rows: fns } = await q(
    `select n.nspname || '.' || p.proname as fn, p.oid::regprocedure::text as sig, p.pronargs as nargs, p.proretset as isset
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('ops', 'shared', 'hr', 'inventory') and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'execute')
        and p.proname in ('donor_directory', 'donor_name', 'patient_picker', 'report_summary', 'report_draws', 'audit_people', 'add_donor_basic')`
  );
  for (const f of fns) {
    const args = Array.from({ length: f.nargs }, () => "null").join(", ");
    const r = await attempt(f.isset ? `select count(*)::int as n from ${f.fn}(${args})` : `select ${f.fn}(${args}) is not null as n`);
    const leaked = r.ok && (f.isset ? r.rows[0].n > 0 : r.rows[0].n === true);
    record(`partner gets nothing from ${f.fn}`, !leaked, r.ok ? `returned ${JSON.stringify(r.rows[0])}` : r.message);
  }

  // ---- 4. her own row ----
  const own = await attempt(`update shared.staff set must_change_pin = false where id = $1`, [me]);
  record("partner clears her own PIN flag", own.ok && own.count === 1, own.message ?? `${own.count} row`);
  const promote = await attempt(`update shared.staff set role = 'admin' where id = $1`, [me]);
  record("partner cannot change her own role", !promote.ok && promote.code === "42501", promote.message ?? "it worked");
  const others = await attempt(`update shared.staff set first_name = first_name where id <> $1`, [me]);
  record("partner cannot touch another staff row", others.ok ? others.count === 0 : true, others.message ?? `${others.count} rows`);

  // ---- 5. the grid: view at most, outside areas only ----
  await q("reset role");
  const edit = await attempt(`update shared.module_access set level = 'edit' where role = 'partner_viewer' and module = 'inventory_stock'`);
  record("the grid refuses 'edit' for a partner role", !edit.ok && edit.code === "23514", edit.message ?? "it worked");
  const inside = await attempt(`insert into shared.module_access (role, module, level) values ('partner_viewer', 'patients', 'view')`);
  record("the grid refuses a staff module for a partner role", !inside.ok && inside.code === "23514", inside.message ?? "it worked");
  const extra = await attempt(`update shared.staff set extra_roles = '{partner_viewer}' where id = $1`, [admin[0].id]);
  record("'partner_viewer' cannot be an additional role", !extra.ok && extra.code === "23514", extra.message ?? "it worked");
  const mixed = await attempt(`update shared.staff set extra_roles = '{finance}' where id = $1`, [me]);
  record("a partner account cannot hold an additional role", !mixed.ok && mixed.code === "23514", mixed.message ?? "it worked");

  // ---- 6. the Inventory partner functions, once laf-inventory 0063 is applied ----
  for (const schema of ["inventory", "inventory_staging"]) {
    const has = (await q("select to_regprocedure($1) is not null as y", [`${schema}.partner_stock()`])).rows[0].y;
    if (!has) continue;
    // Every account the OS creates gets a house (inventory.staff_house); a borrowed test account may
    // not have one in this schema yet.
    await q(`insert into ${schema}.staff_house (staff_id, house_id) select $1, house_id from ${schema}.lots group by house_id order by count(*) desc limit 1 on conflict (staff_id) do nothing`, [me]);
    await q(`update shared.module_access set level = 'view' where role = 'partner_viewer' and module = 'inventory_stock'`);
    await as(me);
    const stock = await attempt(`select * from ${schema}.partner_stock()`);
    const cols = stock.ok && stock.rows[0] ? Object.keys(stock.rows[0]) : [];
    const lotCount = (await q(`select count(*)::int as n from ${schema}.lots`).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
    // A schema with no stock at all (the staging twin on dev) can only show that it answers.
    record(`${schema}: with View, partner sees stock`, stock.ok && (stock.count > 0 || lotCount === 0), stock.message ?? `${stock.count} items${lotCount ? "" : " (no lots in this schema)"} · ${cols.join(", ")}`);
    record(`${schema}: stock carries no cost, donor, lot or staff column`, !cols.some((c) => /cost|value|price|donor|lot|_by|staff|recipient|patient|carer/.test(c)), cols.join(", "));
    const mine = stock.ok ? stock.rows.reduce((n, r) => n + Number(r.on_hand), 0) : NaN;
    await q("reset role");
    const house = (await q(`select house_id from ${schema}.staff_house where staff_id = $1`, [me])).rows[0]?.house_id;
    await as(admin[0].id);
    const truth = (await q(`select coalesce(sum(on_hand_qty), 0)::numeric as n from ${schema}.v_stock_summary where house_id = $1`, [house ?? null])).rows[0].n;
    record(`${schema}: her on-hand total equals the ledger's`, Math.abs(mine - Number(truth)) < 0.001, `partner ${mine} vs ledger ${truth}`);
    await as(me);
    const out = await attempt(`select * from ${schema}.partner_given_out(current_date - 30, current_date)`);
    record(`${schema}: Given out is closed while the grid says None`, !out.ok || out.count === 0, out.message ?? `${out.count} rows`);
    await q("reset role");
    await q(`update shared.module_access set level = 'view' where role = 'partner_viewer' and module = 'inventory_given_out'`);
    await q(`update shared.module_access set level = 'none' where role = 'partner_viewer' and module = 'inventory_stock'`);
    await as(me);
    const out2 = await attempt(`select * from ${schema}.partner_given_out(current_date - 400, current_date)`);
    const cols2 = out2.ok && out2.rows[0] ? Object.keys(out2.rows[0]) : [];
    record(`${schema}: with View, Given out answers and carries no name`, out2.ok && !cols2.some((c) => /recipient|patient|carer|_by|staff|donor|cost|value/.test(c)), out2.message ?? `${out2.count} rows · ${cols2.join(", ")}`);
    const stock2 = await attempt(`select * from ${schema}.partner_stock()`);
    record(`${schema}: stock closes when the grid says None`, !stock2.ok || stock2.count === 0, stock2.message ?? `${stock2.count} rows`);
    await as(admin[0].id);
    const staffCall = await attempt(`select * from ${schema}.partner_stock()`);
    record(`${schema}: the partner function answers partners only`, !staffCall.ok || staffCall.count === 0, staffCall.message ?? `${staffCall.count} rows`);
    await q("reset role");
  }
} catch (e) {
  record("harness", false, e.message);
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
console.table(results);
if (full.length > 1) for (const line of ["Reached through the API schemas:", ...full]) console.log("  " + line);
if (notes.length) console.log("Outside the API (database role only, platform defaults): " + notes.join("; "));
const failed = results.filter((r) => r.result !== "PASS").length;
console.log(failed ? `${failed} FAILED of ${results.length}` : `all ${results.length} passed`);
process.exit(failed ? 1 : 0);
