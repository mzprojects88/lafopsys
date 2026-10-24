import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { Client } from "pg";
import { createClient } from "@/lib/supabase/server";
import { decide } from "@/lib/utils/db-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SCHEMAS = ["ops", "shared", "hr", "inventory"];
const AUTH_TABLES = ["auth.users", "auth.identities"];
/** Rows created on dev's audit log start here, so they never collide with production's running numbers. */
const DEV_AUDIT_OFFSET = 1_000_000_000;

type Table = { name: string; pk: string[]; cols: string[]; identity: boolean };

/**
 * The two-way database sync, production wins (0104). Every hour (pg_cron on production, bearer
 * CALENDAR_SYNC_SECRET) or by an admin's "Sync now": each table of arkos and Inventory, plus the staff
 * logins, is read from both databases as key -> hash of the shared columns, compared with what both
 * sides agreed on last time (sync.row_state), and the decisions (lib/utils/db-sync.ts) are applied in
 * one transaction per side with the tables' own triggers paused and foreign keys checked at commit.
 * Dev commits first: if production's commit fails the agreed state isn't advanced and the next run
 * redoes the same idempotent writes. A rule clash (duplicate AR number, double-booked bed) aborts the
 * run with nothing written. ?dryRun=1 reports without writing; ?init=1 makes dev an exact copy of
 * production and seeds the agreed state. Answers carry counts only.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const init = url.searchParams.get("init") === "1";

  let trigger: "cron" | "manual";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer !== undefined) {
    const expected = process.env.CALENDAR_SYNC_SECRET;
    if (!expected) return NextResponse.json({ ok: false, error: "CALENDAR_SYNC_SECRET is not configured on the server." }, { status: 500 });
    const a = Buffer.from(bearer);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
    trigger = "cron";
  } else {
    const session = await createClient();
    const { data: userData } = await session.auth.getUser();
    if (!userData.user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    const { data: staff } = await session.schema("shared").from("staff").select("role").eq("id", userData.user.id).maybeSingle();
    if (staff?.role !== "admin") return NextResponse.json({ ok: false, error: "Only the Super Admin runs the database sync." }, { status: 403 });
    trigger = "manual";
  }
  const prodUrl = process.env.SYNC_PROD_DB_URL;
  const devUrl = process.env.SYNC_DEV_DB_URL;
  if (!prodUrl || !devUrl) return NextResponse.json({ ok: false, error: "SYNC_PROD_DB_URL / SYNC_DEV_DB_URL are not configured on the server." }, { status: 500 });

  const prod = new Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false } });
  const dev = new Client({ connectionString: devUrl, ssl: { rejectUnauthorized: false } });
  await prod.connect();
  await dev.connect();
  // Hashes compare text renderings on both sides: same time zone, same numbers.
  await prod.query("set time zone 'UTC'");
  await dev.query("set time zone 'UTC'");

  const { rows: running } = await prod.query(`select 1 from sync.runs where status = 'running' and started_at > now() - interval '6 minutes' limit 1`);
  if (running.length) {
    await Promise.all([prod.end(), dev.end()]);
    return NextResponse.json({ ok: false, error: "A sync is already running." }, { status: 409 });
  }
  const mode = init ? "init" : dryRun ? "dry_run" : "sync";
  const { rows: runRows } = await prod.query<{ id: string }>(`insert into sync.runs (trigger, mode) values ($1, $2) returning id`, [trigger, mode]);
  const runId = runRows[0].id;
  const counts = { toDev: 0, toProd: 0, deletedOnDev: 0, deletedOnProd: 0, conflicts: 0, tables: 0 };

  try {
    const tables = await sharedTables(prod, dev);
    counts.tables = tables.length;
    if (init) {
      await initialise(prod, dev, tables);
      await prod.query(`update sync.runs set status = 'success', finished_at = now(), note = 'dev made a copy of production; agreed state seeded' where id = $1`, [runId]);
      await Promise.all([prod.end(), dev.end()]);
      return NextResponse.json({ ok: true, mode, tables: tables.length });
    }

    const [prodHashes, devHashes, stateRows] = await Promise.all([hashes(prod, tables), hashes(dev, tables), prod.query<{ table_name: string; pk: string; hash: string }>(`select table_name, pk, hash from sync.row_state`)]);
    const state = new Map<string, Map<string, string>>();
    for (const r of stateRows.rows) {
      if (!state.has(r.table_name)) state.set(r.table_name, new Map());
      state.get(r.table_name)!.set(r.pk, r.hash);
    }
    // Until the first copy (?init=1) nothing has been agreed: a plain run would push every stray dev row to production.
    if (!dryRun && stateRows.rowCount === 0) throw new Error("The sync has not been initialised: run it once with ?init=1 after the databases are merged.");
    const plan = tables.map((t) => ({ t, d: decide(state.get(t.name) ?? new Map(), prodHashes.get(t.name) ?? new Map(), devHashes.get(t.name) ?? new Map()) }));
    for (const { d } of plan) {
      counts.toDev += d.toDev.length;
      counts.toProd += d.toProd.length;
      counts.deletedOnDev += d.deleteOnDev.length;
      counts.deletedOnProd += d.deleteOnProd.length;
      counts.conflicts += d.conflicts.length;
    }
    const conflictRows = plan.flatMap(({ t, d }) => d.conflicts.map((c) => ({ table_name: t.name, pk: c.pk, what: c.what })));

    if (!dryRun) {
      await dev.query("begin");
      await prod.query("begin");
      await dev.query("set constraints all deferred");
      await prod.query("set constraints all deferred");
      const touched = plan.filter(({ d }) => d.toDev.length || d.toProd.length || d.deleteOnDev.length || d.deleteOnProd.length);
      for (const { t } of touched) {
        await dev.query(`alter table ${t.name} disable trigger user`);
        await prod.query(`alter table ${t.name} disable trigger user`);
      }
      for (const { t, d } of touched) {
        await copyRows(prod, dev, t, d.toDev);
        await copyRows(dev, prod, t, d.toProd);
        if (d.deleteOnDev.length) await dev.query(`delete from ${t.name} where ${keyExpr(t)} = any($1)`, [d.deleteOnDev]);
        if (d.deleteOnProd.length) await prod.query(`delete from ${t.name} where ${keyExpr(t)} = any($1)`, [d.deleteOnProd]);
      }
      for (const { t } of touched) {
        await dev.query(`alter table ${t.name} enable trigger user`);
        await prod.query(`alter table ${t.name} enable trigger user`);
      }
      // The agreed state: replaced whole for the tables synced (small: one row per row).
      await prod.query(`delete from sync.row_state where table_name = any($1)`, [tables.map((t) => t.name)]);
      const agreed = plan.flatMap(({ t, d }) => [...d.agreed].map(([pk, hash]) => ({ table_name: t.name, pk, hash })));
      for (let i = 0; i < agreed.length; i += 5000) {
        await prod.query(`insert into sync.row_state (table_name, pk, hash) select table_name, pk, hash from jsonb_to_recordset($1::jsonb) as x(table_name text, pk text, hash text)`, [JSON.stringify(agreed.slice(i, i + 5000))]);
      }
      if (conflictRows.length) await prod.query(`insert into sync.conflicts (run_id, table_name, pk, what) select $1, table_name, pk, what from jsonb_to_recordset($2::jsonb) as x(table_name text, pk text, what text)`, [runId, JSON.stringify(conflictRows)]);
      await prod.query(`update sync.runs set status = 'success', finished_at = now(), to_dev = $2, to_prod = $3, deleted_on_dev = $4, deleted_on_prod = $5, conflicts = $6 where id = $1`, [runId, counts.toDev, counts.toProd, counts.deletedOnDev, counts.deletedOnProd, counts.conflicts]);
      await dev.query("commit");
      await prod.query("commit");
    } else {
      await prod.query(`update sync.runs set status = 'success', finished_at = now(), to_dev = $2, to_prod = $3, deleted_on_dev = $4, deleted_on_prod = $5, conflicts = $6, note = 'dry run: nothing written' where id = $1`, [runId, counts.toDev, counts.toProd, counts.deletedOnDev, counts.deletedOnProd, counts.conflicts]);
    }
    await Promise.all([prod.end(), dev.end()]);
    return NextResponse.json({ ok: true, mode, ...counts, conflictTables: [...new Set(conflictRows.map((c) => c.table_name))] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await dev.query("rollback").catch(() => {});
    await prod.query("rollback").catch(() => {});
    await prod.query(`update sync.runs set status = 'failed', finished_at = now(), error = $2 where id = $1`, [runId, message.slice(0, 4000)]).catch(() => {});
    await Promise.all([prod.end(), dev.end()]).catch(() => {});
    return NextResponse.json({ ok: false, mode, error: message }, { status: 500 });
  }
}

const ident = (c: string) => `"${c.replace(/"/g, '""')}"`;
const keyExpr = (t: Table) => t.pk.map((k) => `${ident(k)}::text`).join(" || '|' || ");

/** Tables on both sides (and their shared, non-generated columns), with the primary key as production has it. */
async function sharedTables(prod: Client, dev: Client): Promise<Table[]> {
  const sql = `
    select n.nspname || '.' || c.relname as name,
           array(select a.attname::text from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = c.oid and i.indisprimary order by a.attnum) as pk,
           array(select col.column_name::text from information_schema.columns col where col.table_schema = n.nspname and col.table_name = c.relname and col.is_generated = 'NEVER' order by col.ordinal_position) as cols,
           exists (select 1 from information_schema.columns col where col.table_schema = n.nspname and col.table_name = c.relname and col.is_identity = 'YES') as identity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r' and (n.nspname = any($1) or n.nspname || '.' || c.relname = any($2))
     order by 1`;
  type Row = { name: string; pk: string[]; cols: string[]; identity: boolean };
  const [p, d] = await Promise.all([prod.query<Row>(sql, [SCHEMAS, AUTH_TABLES]), dev.query<Row>(sql, [SCHEMAS, AUTH_TABLES])]);
  const devCols = new Map(d.rows.map((r) => [r.name, new Set(r.cols)]));
  return p.rows
    .filter((r) => devCols.has(r.name) && r.pk.length)
    .map((r) => ({ name: r.name, pk: r.pk, cols: r.cols.filter((c) => devCols.get(r.name)!.has(c)), identity: r.identity }));
}

/** key -> md5 of the shared columns, for every table, in one round trip per side. */
async function hashes(c: Client, tables: Table[]): Promise<Map<string, Map<string, string>>> {
  const sql = tables.map((t) => `select '${t.name}' as t, ${keyExpr(t).replace(/"(\w+)"/g, '_r."$1"')} as k, md5(row(${t.cols.map((x) => `_r.${ident(x)}`).join(", ")})::text) as h from ${t.name} _r`).join("\nunion all\n");
  const out = new Map<string, Map<string, string>>();
  const { rows } = await c.query<{ t: string; k: string; h: string }>(sql);
  for (const r of rows) {
    if (!out.has(r.t)) out.set(r.t, new Map());
    out.get(r.t)!.set(r.k, r.h);
  }
  return out;
}

/** Rows go across as the JSON text the source rendered (numbers and dates untouched by JavaScript). */
async function copyRows(from: Client, to: Client, t: Table, keys: string[]) {
  if (!keys.length) return;
  const cols = t.cols.map(ident).join(", ");
  const { rows } = await from.query<{ j: string }>(`select to_jsonb(_r)::text as j from (select ${cols} from ${t.name}) _r where ${keyExpr(t).replace(/"(\w+)"/g, '_r."$1"')} = any($1)`, [keys]);
  const json = `[${rows.map((r) => r.j).join(",")}]`;
  const set = t.cols.filter((c) => !t.pk.includes(c)).map((c) => `${ident(c)} = excluded.${ident(c)}`).join(", ");
  await to.query(
    `insert into ${t.name} (${cols})${t.identity ? " overriding system value" : ""} select ${cols} from jsonb_populate_recordset(null::${t.name}, $1::jsonb)
     on conflict (${t.pk.map(ident).join(", ")}) do ${set ? `update set ${set}` : "nothing"}`,
    [json]
  );
}

/** Dev becomes an exact copy of production for every shared table; the agreed state is seeded. */
async function initialise(prod: Client, dev: Client, tables: Table[]) {
  await dev.query("begin");
  await dev.query("set constraints all deferred");
  for (const t of tables) await dev.query(`alter table ${t.name} disable trigger user`);
  await dev.query(`truncate ${tables.map((t) => t.name).join(", ")} cascade`);
  for (const t of tables) {
    const cols = t.cols.map(ident).join(", ");
    for (let i = 0; ; i += 2000) {
      const { rows } = await prod.query<{ j: string }>(`select to_jsonb(_r)::text as j from (select ${cols} from ${t.name}) _r order by ${t.pk.map((k) => `_r.${ident(k)}`).join(", ")} offset $1 limit 2000`, [i]);
      if (!rows.length) break;
      await dev.query(`insert into ${t.name} (${cols})${t.identity ? " overriding system value" : ""} select ${cols} from jsonb_populate_recordset(null::${t.name}, $1::jsonb)`, [`[${rows.map((r) => r.j).join(",")}]`]);
      if (rows.length < 2000) break;
    }
  }
  for (const t of tables) await dev.query(`alter table ${t.name} enable trigger user`);
  await dev.query(`select setval('inventory.audit_log_id_seq', greatest((select coalesce(max(id), 0) from inventory.audit_log), 0) + $1)`, [DEV_AUDIT_OFFSET]);
  const prodHashes = await hashes(prod, tables);
  await prod.query("begin");
  await prod.query(`delete from sync.row_state`);
  const agreed = [...prodHashes].flatMap(([table_name, m]) => [...m].map(([pk, hash]) => ({ table_name, pk, hash })));
  for (let i = 0; i < agreed.length; i += 5000) {
    await prod.query(`insert into sync.row_state (table_name, pk, hash) select table_name, pk, hash from jsonb_to_recordset($1::jsonb) as x(table_name text, pk text, hash text)`, [JSON.stringify(agreed.slice(i, i + 5000))]);
  }
  await dev.query("commit");
  await prod.query("commit");
}
