// The 0149 pre-flight (voucher certification and signatures), on the development database and ALWAYS rolled back:
// only the person (and the Super Admin) read a signature, nobody writes one from the browser, and the
// certification setting keeps its default and its limit.
//   node --env-file=.env.local scripts/rls/signature-matrix.mjs
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
  await c.query(readFileSync(new URL("../../supabase/migrations/0149_voucher_branding_signatures.sql", import.meta.url), "utf8"));
  const ids = (await c.query(`select
    (select id from shared.staff where active and role = 'admin' order by id limit 1) admin,
    (select id from shared.staff where active and role = 'finance' and not ('admin' = any(extra_roles)) limit 1) finance,
    (select id from shared.staff where active and role = 'driver' and extra_roles = '{}' limit 1) driver`)).rows[0];
  for (const [k, v] of Object.entries(ids)) if (!v) throw new Error(`fixture missing: ${k}`);
  // What the server writes (service role) for Finance's signature.
  await c.query(`insert into shared.staff_signatures (staff_id, object_key, content_type, bytes) values ($1, 'HR/Signatures/test.png', 'image/png', 100)`, [ids.finance]);

  await step("Finance reads their own signature", ids.finance, "select count(*)::int n from shared.staff_signatures where staff_id = $1", [ids.finance], n(1));
  await step("the driver can't read Finance's", ids.driver, "select count(*)::int n from shared.staff_signatures", [], n(0));
  await step("the Super Admin reads it (to remove one)", ids.admin, "select count(*)::int n from shared.staff_signatures where staff_id = $1", [ids.finance], n(1));
  await step("nobody writes a signature from the browser", ids.finance, "insert into shared.staff_signatures (staff_id, object_key, content_type, bytes) values ($1, 'x', 'image/png', 1)", [ids.driver], refused("42501"), false);
  await step("... not even their own", ids.driver, "insert into shared.staff_signatures (staff_id, object_key, content_type, bytes) values ($1, 'x', 'image/png', 1)", [ids.driver], refused("42501"), false);
  await step("... nor deletes one", ids.finance, "delete from shared.staff_signatures where staff_id = $1", [ids.finance], refused("42501"), false);
  await step("only PNG or JPG, up to 1 MB", null, "insert into shared.staff_signatures (staff_id, object_key, content_type, bytes) values ($1, 'x', 'image/gif', 2000000)", [ids.driver], refused("23514"), false);
  await step("the certification has the paper's wording by default", null, "select voucher_certification like 'I certify that this disbursement%' ok from shared.app_settings", [], (r) => r.ok && r.rows[0].ok === true);
  await step("... and can't be emptied", null, "update shared.app_settings set voucher_certification = '  '", [], refused("23514"), false);
  await step("the log is readable by its person, not by others", ids.driver, "select count(*)::int n from shared.staff_signature_log where staff_id = $1", [ids.finance], n(0));
} finally {
  await c.query("rollback");
  await c.end();
  console.log(`\n${pass} passed, ${fail} failed (rolled back)`);
}
