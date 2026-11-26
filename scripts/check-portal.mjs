// Proves the Volunteers Portal's database part (0182: accounts, sessions, issue, lock, status), writing nothing that
// stays: everything runs in one transaction that is rolled back. Made-up groups (example.org).
//   node --env-file=.env.local scripts/check-portal.mjs [--with-migration <file>]
// Development only.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import pg from "pg";
import { isProd, pgUrl } from "./lib/db-url.mjs";

if (isProd()) throw new Error("development only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
let failures = 0;
const check = (name, ok, note = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : note ? " | " + String(note).slice(0, 220) : ""}`); if (!ok) failures++; };
const tryIt = async (sql, params) => {
  await c.query("savepoint s");
  try { const rows = await q(sql, params); await c.query("release savepoint s"); return { ok: true, rows }; }
  catch (e) { await c.query("rollback to savepoint s"); return { ok: false, code: e.code, error: e.message }; }
};
const service = async () => { await c.query("reset role"); };
const as = async (staffId) => {
  await c.query("reset role");
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: staffId, role: "authenticated" })]);
  await c.query("set local role authenticated");
  await c.query("discard plans");
};
const sha = (s) => createHash("sha256").update(s).digest("hex");
const item = (activity, start, end) => ({ activity, source: "list", purpose: "To bring joy", who: "patients", ages: "4 to 12", gender: "all", start_time: start, end_time: end, materials: "Books" });
const payload = (place, date, more = {}) => ({
  place_id: place, date, start_time: "10:00", requestor_name: "Sample Portal Group", requestor_kind: "school", contact_person: "Sample Contact",
  email: "portal@example.org", mobile: "0917 000 0030", volunteers_count: 3, has_minors: false,
  items: [item("Book Reading", "10:00", "11:00")], agree_guidelines: true, agree_privacy: true, ...more,
});

try {
  await c.query("begin");
  const i = process.argv.indexOf("--with-migration");
  if (i > 0) await c.query(readFileSync(process.argv[i + 1], "utf8"));
  const place = await one("select id from booking.places where open order by sort limit 1");
  const open = (await q("select day::text from booking.slot_states($1, booking.today(), booking.today() + 60) where state = 'open' order by day", [place.id])).map((r) => r.day);
  const first = (await one("select booking.web_request($1::jsonb, 'pc-1') r", [JSON.stringify(payload(place.id, open[0]))])).r;
  const group = (await one("select group_id from booking.requests where id = $1", [first.id])).group_id;

  // ---- who may issue ----
  const pick = async (role) => (await one("select id from shared.staff where active and role = $1 order by created_at limit 1", [role]))?.id;
  const worker = await pick("social_worker");
  const finance = await pick("finance");
  const chef = await pick("chef");
  await c.query(`insert into shared.role_page_access (role, page, level)
    select r.role, 'volunteers.list', r.level from (values ('social_worker', 'edit'), ('finance', 'view')) r(role, level) on conflict do nothing`);
  for (const id of [worker, finance, chef].filter(Boolean)) {
    await c.query("update shared.staff set extra_roles = '{}' where id = $1", [id]);
    await c.query("delete from shared.staff_module_access where staff_id = $1", [id]);
  }
  const otp = "ABCDE-FGH23";
  if (finance) {
    await as(finance);
    const no = await tryIt("select booking.portal_issue($1, $2)", [group, sha(otp)]);
    const status = await tryIt("select count(*)::int n from booking.portal_status()");
    check("Accounting may see a portal's status but not give access", !no.ok && no.code === "42501" && status.ok, no.error ?? status.error ?? "it issued");
  }
  if (!worker) throw new Error("no active social worker on development");
  await as(worker);
  const badHash = await tryIt("select booking.portal_issue($1, 'not-a-hash')", [group]);
  const issued = await tryIt("select booking.portal_issue($1, $2) v", [group, sha(otp)]);
  check("the social worker gives portal access with only the one-time password's hash", !badHash.ok && issued.ok && issued.rows[0].v.email === "portal@example.org", badHash.error ?? issued.error);
  const st = await one("select state from booking.portal_status() where group_id = $1", [group]);
  check("the portal then reads as issued, waiting for the first sign-in", st?.state === "issued", JSON.stringify(st));
  const peek = await tryIt("select otp_hash from booking.portal_accounts");
  const peekSessions = await tryIt("select token_hash from booking.portal_sessions");
  check("nobody signed in to ArkOS reads the hashes, not even the one who issued them", !peek.ok && peek.code === "42501" && !peekSessions.ok && peekSessions.code === "42501", JSON.stringify({ peek: peek.ok, sessions: peekSessions.ok }));
  if (chef) {
    await as(chef);
    const st2 = await tryIt("select count(*)::int n from booking.portal_status()");
    const no = await tryIt("select booking.portal_lock($1, true)", [group]);
    check("a role without Volunteers or Bookings sees no portal and cannot lock one", st2.ok && st2.rows[0].n === 0 && !no.ok && no.code === "42501", st2.error ?? no.error ?? "it locked");
  }
  await service();
  const anon = await tryIt("set local role anon; select count(*) from booking.portal_accounts");
  await service();
  check("nobody outside reads the accounts", !anon.ok);

  // ---- after a sign-in with the one-time password (the ArkOS server uses it up then) ----
  await service();
  await c.query("update booking.portal_accounts set otp_used_at = now() where group_id = $1", [group]);
  await as(worker);
  const st1 = await one("select state from booking.portal_status() where group_id = $1", [group]);
  check("once the one-time password is used, the portal reads as signed in without a password yet", st1?.state === "setup", JSON.stringify(st1));
  await c.query("select booking.portal_issue($1, $2)", [group, sha(otp)]);

  // ---- a group without an email ----
  await as(worker);
  const noMailGroup = (await one("select booking.staff_request($1::jsonb) r", [JSON.stringify(payload(place.id, open[1], { email: "", requestor_name: "Sample Walk-in", channel: "walk_in" }))])).r;
  const nmg = (await one("select group_id from booking.requests where id = $1", [noMailGroup.id])).group_id;
  const noMail = await tryIt("select booking.portal_issue($1, $2)", [nmg, sha("X")]);
  check("a group without an email address gets no portal access", !noMail.ok && /no email address/.test(noMail.error), noMail.error ?? "issued");

  // ---- sessions (as the ArkOS server writes them) and lock ----
  await service();
  await c.query("insert into booking.portal_sessions (group_id, token_hash, setup_only, expires_at) values ($1, $2, true, now() + interval '30 days'), ($1, $3, false, now() + interval '30 days')", [group, sha("t1"), sha("t2")]);
  await as(worker);
  const locked = await tryIt("select booking.portal_lock($1, true)", [group]);
  await service();
  const live = await one("select count(*)::int n from booking.portal_sessions where group_id = $1 and ended_at is null", [group]);
  check("locking a group ends every open session, and the portal reads as locked", locked.ok && live.n === 0 && (await one("select state from booking.portal_status() where group_id = $1", [group]).catch(() => null)) === undefined || (locked.ok && live.n === 0), locked.error ?? JSON.stringify(live));
  await as(worker);
  const st3 = await one("select state from booking.portal_status() where group_id = $1", [group]);
  check("(status: locked)", st3?.state === "locked", JSON.stringify(st3));
  await c.query("select booking.portal_lock($1, false)", [group]);
  // issuing again resets the password and ends sessions
  await service();
  await c.query("update booking.portal_accounts set password_hash = 'scrypt$x', must_set_password = false, password_set_at = now() where group_id = $1", [group]);
  await c.query("insert into booking.portal_sessions (group_id, token_hash, expires_at) values ($1, $2, now() + interval '30 days')", [group, sha("t3")]);
  await as(worker);
  const active = await one("select state from booking.portal_status() where group_id = $1", [group]);
  await c.query("select booking.portal_issue($1, $2)", [group, sha("NEWPASS-23")]);
  await service();
  const reset = await one("select password_hash, must_set_password, (select count(*)::int from booking.portal_sessions s where s.group_id = a.group_id and s.ended_at is null) open_sessions from booking.portal_accounts a where group_id = $1", [group]);
  check("issuing again (a forgotten password) clears the password and ends open sessions", active?.state === "active" && reset.password_hash === null && reset.must_set_password === true && reset.open_sessions === 0, JSON.stringify({ active, reset }));

  // ---- a public request no longer rewrites a group with a portal account ----
  await service();
  await one("select booking.web_request($1::jsonb, 'pc-2') r", [JSON.stringify(payload(place.id, open[2], { contact_person: "Someone Else", mobile: "0917 999 9999", requestor_name: "Another Name" }))]);
  const kept = await one("select name, contact_person, mobile, (select count(*)::int from booking.requests where group_id = g.id) bookings from booking.groups g where id = $1", [group]);
  check("a public request with the group's email joins the group but leaves its details alone", kept.name === "Sample Portal Group" && kept.contact_person === "Sample Contact" && kept.mobile === "0917 000 0030" && kept.bookings === 2, JSON.stringify(kept));
  const other = await one("select booking.web_request($1::jsonb, 'pc-3') r", [JSON.stringify(payload(place.id, open[3], { email: "noportal@example.org", contact_person: "First" }))]);
  await one("select booking.web_request($1::jsonb, 'pc-4') r", [JSON.stringify(payload(place.id, open[4], { email: "noportal@example.org", contact_person: "Second" }))]);
  check("a group without a portal account still follows its latest request", (await one("select contact_person from booking.groups where lower(email) = 'noportal@example.org'")).contact_person === "Second" && !!other.r?.ref);
} catch (e) {
  failures++;
  console.log("FAIL", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `${failures} failed` : "all passed (rolled back)");
process.exit(failures ? 1 : 0);
