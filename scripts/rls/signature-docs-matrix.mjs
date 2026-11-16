// The 0153 pre-flight (signatures on generated documents), on the development database and ALWAYS rolled back:
// applies the migration in a transaction and proves who may read and write the owner's choice and the use log.
//   node --env-file=.env.local scripts/rls/signature-docs-matrix.mjs
import { readFileSync } from "node:fs";
import pg from "pg";
import { pgUrl, isProd } from "../lib/db-url.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("dev only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let pass = 0, fail = 0;
async function step(name, who, sql, params, expect) {
  await c.query("savepoint s");
  let r;
  try {
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who ? { sub: who, role: "authenticated" } : {})]);
    if (who) {
      await c.query("set local role authenticated");
      await c.query("discard plans");
    }
    const q = await c.query(sql, params);
    r = { ok: true, rows: q.rows, n: q.rowCount };
  } catch (e) {
    r = { ok: false, error: e.message, code: e.code };
  }
  await c.query("rollback to savepoint s");
  await c.query("reset role");
  const good = expect(r);
  if (good) pass++;
  else fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${name}  ${r.ok ? `rows=${r.n}` : `${r.code} ${r.error.slice(0, 90)}`}`);
}
const refused = (r) => !r.ok && r.code === "42501";

try {
  await c.query("begin");
  await c.query(readFileSync(new URL("../../supabase/migrations/0153_signature_on_documents.sql", import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where role = 'admin' and active order by id limit 1) admin,
    (select id from shared.staff where role = 'finance' and active limit 1) owner,
    (select id from shared.staff where role = 'driver' and active limit 1) other`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);
  await c.query(`insert into shared.staff_signatures (staff_id, object_key, content_type, bytes, allowed_docs) values ($1, 'HR/Signatures/test/x.png', 'image/png', 10, '{report}')
    on conflict (staff_id) do update set allowed_docs = '{report}'`, [ids.owner]);
  await c.query(`insert into shared.signature_uses (staff_id, doc_type, doc_ref, by_staff_id) values ($1, 'report', 'Test report', $2)`, [ids.owner, ids.other]);

  await step("the owner reads their own choice", ids.owner, `select allowed_docs from shared.staff_signatures where staff_id = $1`, [ids.owner], (r) => r.ok && r.n === 1);
  await step("the owner can't change the choice in the table (the server does, logged)", ids.owner, `update shared.staff_signatures set allowed_docs = '{voucher}' where staff_id = $1`, [ids.owner], refused);
  await step("someone else can't see another person's signature row", ids.other, `select 1 from shared.staff_signatures where staff_id = $1`, [ids.owner], (r) => r.ok && r.n === 0);
  await step("someone else can't allow documents for them", ids.other, `update shared.staff_signatures set allowed_docs = '{voucher}' where staff_id = $1`, [ids.owner], refused);
  await step("the owner sees where their signature was used", ids.owner, `select doc_ref from shared.signature_uses where staff_id = $1`, [ids.owner], (r) => r.ok && r.n === 1);
  await step("the person who generated the document doesn't see the owner's log", ids.other, `select 1 from shared.signature_uses`, [], (r) => r.ok && r.n === 0);
  await step("the Super Admin sees the uses", ids.admin, `select 1 from shared.signature_uses where staff_id = $1`, [ids.owner], (r) => r.ok && r.n === 1);
  await step("nobody writes the use log from the browser", ids.owner, `insert into shared.signature_uses (staff_id, doc_type, doc_ref) values ($1, 'report', 'x')`, [ids.owner], refused);
  await step("nobody erases the use log", ids.admin, `delete from shared.signature_uses`, [], refused);
  await step("a signed-out visitor reads nothing", null, `set local role anon; select 1 from shared.signature_uses`, [], (r) => !r.ok);
  await step("an unknown kind of document is refused by the table", null, `update shared.staff_signatures set allowed_docs = '{passport}' where staff_id = $1`, [ids.owner], (r) => !r.ok && r.code === "23514");
  await step("the change log takes the new 'allowed' action with its list", null, `insert into shared.staff_signature_log (staff_id, action, by_staff_id, docs) values ($1, 'allowed', $1, '{report}')`, [ids.owner], (r) => r.ok);
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
