// Proves the Volunteers step 1 (0181: groups, members with emails, the volunteer log, the Volunteers menu), writing
// nothing that stays: everything runs in one transaction that is rolled back. Made-up groups (example.org).
//   node --env-file=.env.local scripts/check-volunteers.mjs [--with-migration <file>]
// Development only. Without --with-migration it checks the database as it is (0181 applied).
import { readFileSync } from "node:fs";
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
const item = (activity, start, end) => ({ activity, source: "list", purpose: "To bring joy", who: "patients", ages: "4 to 12", gender: "all", start_time: start, end_time: end, materials: "Books" });
const payload = (place, date, more = {}) => ({
  place_id: place, date, start_time: "10:00", requestor_name: "Sample Volunteers Inc.", requestor_kind: "company", contact_person: "Sample Person",
  email: "group@example.org", mobile: "0917 000 0000", volunteers_count: 4, has_minors: false,
  items: [item("Book Reading", "10:00", "11:00"), item("Drawing", "11:00", "12:00")], agree_guidelines: true, agree_privacy: true, ...more,
});
const file = async (p, caller) => (await one("select booking.web_request($1::jsonb, $2) r", [JSON.stringify(p), caller])).r;

try {
  await c.query("begin");
  const place = await one("select id, name from booking.places where open order by sort limit 1");
  const open = (await q("select day::text from booking.slot_states($1, booking.today(), booking.today() + 60) where state = 'open' order by day", [place.id])).map((r) => r.day);
  const i = process.argv.indexOf("--with-migration");
  let early = null;
  if (i > 0) {
    // A request filed before the migration, to see it given a group.
    early = await file(payload(place.id, open[0], { email: "early@example.org", requestor_name: "Sample Early Group" }), "vc-early");
    await c.query(readFileSync(process.argv[i + 1], "utf8"));
    const g = await one("select g.email, g.name from booking.requests r join booking.groups g on g.id = r.group_id where r.id = $1", [early.id]);
    check("a request filed before the migration is given its group", g?.email === "early@example.org" && g.name === "Sample Early Group", JSON.stringify(g));
  }

  // ---- groups ----
  const a = await file(payload(place.id, open[1]), "vc-a");
  const b = await file(payload(place.id, open[2], { email: "GROUP@example.org", contact_person: "Sample Person Two", mobile: "0917 000 0002" }), "vc-b");
  const ga = await one("select group_id from booking.requests where id = $1", [a.id]);
  const gb = await one("select group_id from booking.requests where id = $1", [b.id]);
  const g = await one("select contact_person, mobile, (select count(*)::int from booking.groups where lower(email) = 'group@example.org') n from booking.groups where id = $1", [ga.group_id]);
  check("two requests from the same email, however it is typed, are one group, and its details follow the latest", ga.group_id === gb.group_id && g.n === 1 && g.contact_person === "Sample Person Two" && g.mobile === "0917 000 0002", JSON.stringify({ ...g, same: ga.group_id === gb.group_id }));

  // ---- members: full name and email ----
  await c.query("update booking.requests set status = 'approved' where id = $1", [a.id]);
  const noMail = await tryIt("select booking.web_names($1, $2::jsonb, 'vc-n') v", [a.ref, JSON.stringify(["Sample One", "Sample Two"])]);
  check("members without an email address are refused, in the page's words", !noMail.ok && /Please give the email address of Sample One/.test(noMail.error), noMail.error ?? "accepted");
  const given = await tryIt("select booking.web_names($1, $2::jsonb, 'vc-n') v", [a.ref, JSON.stringify([
    { name: "Sample One", email: "One@Example.org" },
    { name: "Sample Two", email: "two@example.org" },
    { name: "Sample Child A", email: "parent@example.org", under18: true },
    { name: "Sample Child B", email: "parent@example.org", under18: true },
  ])]);
  const view = given.ok ? given.rows[0].v : {};
  check("members are kept with name, email and under 18, and the look-up shows their emails masked", given.ok && view.members?.length === 4 && view.members[0].email === "o***@example.org" && view.members[2].under18 === true && view.names?.length === 4, given.error ?? JSON.stringify(view.members));
  const masked = await tryIt("select booking.web_names($1, $2::jsonb, 'vc-n') v", [a.ref, JSON.stringify(view.members.map((m) => ({ ...m, name: m.name })))]);
  const kept = await q("select v.name, v.email from booking.volunteers v join booking.requests r on r.id = v.request_id where r.ref = $1 order by v.position", [a.ref]);
  check("sending the list back as the page shows it (emails masked) keeps the emails on record", masked.ok && kept.map((k) => k.email).join() === "one@example.org,two@example.org,parent@example.org,parent@example.org", masked.error ?? JSON.stringify(kept));
  const tooMany = await tryIt("select booking.web_names($1, $2::jsonb, 'vc-n') v", [a.ref, JSON.stringify(Array.from({ length: 5 }, (_, n) => ({ name: `Sample Person ${n}`, email: `p${n}@example.org` })))]);
  check("never more members than the booking is for", !tooMany.ok && /for 4 volunteers/.test(tooMany.error), tooMany.error ?? "accepted");
  const privacy = await one("select privacy_notice from booking.settings");
  check("the privacy notice carries the approved line once", (privacy.privacy_notice.match(/the dates and the places they volunteered/g) ?? []).length === 1 && !/leave it empty/.test(privacy.privacy_notice));

  // ---- the volunteer log, with the switch off (as on development) ----
  await c.query("update booking.requests set date = booking.today() - 1 where id = $1", [a.id]);
  await c.query("update booking.requests set status = 'completed', attended_children = 12, attended_volunteers = 4, attended_hours = 2 where id = $1", [a.id]);
  const offPersons = await one("select count(*)::int n from ops.volunteers where lower(email) like '%@example.org'");
  check("with the switch off, a recorded visit writes no volunteer and no log line", offPersons.n === 0, JSON.stringify(offPersons));

  // ---- with the switch on (as on production) ----
  await c.query("update booking.settings set feeds_ops = true");
  await c.query("select booking.sync_volunteer_log($1)", [a.id]);
  const log = await q("select v.first_name, v.last_name, v.email, h.hours::float h, h.place, h.source, h.activity, h.date::text d from ops.volunteer_hours h join ops.volunteers v on v.id = h.volunteer_id where h.booking_request_id = $1 order by v.first_name, v.last_name", [a.id]);
  check("each member who came becomes a volunteer with a line: the date, where, the activity, the visit's hours", log.length === 4 && log.every((l) => l.h === 2 && l.place === place.name && l.source === "booking" && l.activity === "Activity Center") && log.some((l) => l.first_name === "Sample" && l.last_name === "One"), JSON.stringify(log));
  check("two children under one parent's email are two volunteers", log.filter((l) => l.email === "parent@example.org").length === 2);
  const tot = await one("select total_hours::float t, last_session_date::text d from ops.volunteers where lower(email) = 'one@example.org'");
  check("the volunteer's total hours and last date follow the log", tot.t === 2 && tot.d === log[0].d, JSON.stringify(tot));
  await c.query("update booking.volunteers set came = false where email = 'two@example.org'");
  const afterNo = await one("select count(*)::int n from ops.volunteer_hours where booking_request_id = $1", [a.id]);
  const twoTotal = await one("select total_hours::float t from ops.volunteers where lower(email) = 'two@example.org'");
  check("marking someone as not having come removes their line and their hours", afterNo.n === 3 && twoTotal.t === 0, JSON.stringify({ afterNo, twoTotal }));
  await c.query("update booking.volunteers set came = true where email = 'two@example.org'");
  check("marking them back adds the line again", (await one("select count(*)::int n from ops.volunteer_hours where booking_request_id = $1", [a.id])).n === 4);
  const persons = await one("select count(*)::int n from ops.volunteers where lower(email) like '%@example.org'");
  check("the same people are not made twice", persons.n === 4, JSON.stringify(persons));

  // A second visit by the same group: the same volunteers, a second line each.
  await c.query("update booking.requests set status = 'approved' where id = $1", [b.id]);
  await c.query("select booking.web_names($1, $2::jsonb, 'vc-n')", [b.ref, JSON.stringify([{ name: "Sample  one", email: "one@example.org" }])]);
  await c.query("update booking.requests set date = booking.today() - 8, status = 'completed', attended_hours = 1.5 where id = $1", [b.id]);
  const again = await one("select count(*)::int lines, sum(h.hours)::float hours, count(distinct v.id)::int people from ops.volunteer_hours h join ops.volunteers v on v.id = h.volunteer_id where lower(v.email) = 'one@example.org'");
  check("a second visit adds a second line to the same volunteer", again.lines === 2 && again.hours === 3.5 && again.people === 1, JSON.stringify(again));

  // ---- access ----
  await c.query(`insert into shared.role_page_access (role, page, level)
    select r.role, 'volunteers.list', r.level from (values ('social_worker', 'edit'), ('office_admin', 'edit'), ('house_staff', 'edit'), ('finance', 'view'), ('ceo', 'view')) r(role, level)
    where exists (select 1 from shared.roles where key = r.role) on conflict do nothing`);
  const levels = await q("select role, level from shared.module_access where module = 'volunteers' order by role");
  check("the page rows give the Volunteers menu its level", levels.map((l) => `${l.role}=${l.level}`).join() === "ceo=view,finance=view,house_staff=edit,office_admin=edit,social_worker=edit", JSON.stringify(levels));
  const pick = async (role) => (await one("select id from shared.staff where active and role = $1 order by created_at limit 1", [role]))?.id;
  const finance = await pick("finance");
  const chef = await pick("chef");
  const worker = await pick("social_worker");
  for (const [who, id] of [["finance", finance], ["chef", chef], ["social_worker", worker]]) {
    if (!id) continue;
    await c.query("update shared.staff set extra_roles = '{}' where id = $1", [id]);
    await c.query("delete from shared.staff_module_access where staff_id = $1", [id]);
  }
  if (finance) {
    await as(finance);
    const sees = await tryIt("select (select count(*)::int from ops.volunteers where lower(email) like '%@example.org') people, (select count(*)::int from booking.groups where lower(email) = 'group@example.org') groups");
    const writes = await tryIt("insert into ops.volunteers (first_name, last_name, focus_area) values ('Sample', 'Writer', 'Events') returning id");
    check("Accounting sees the volunteers and the groups, and cannot add one", sees.ok && sees.rows[0].people === 4 && sees.rows[0].groups === 1 && !writes.ok, sees.error ?? writes.error ?? "it wrote");
  }
  if (worker) {
    // The staff members editor writes the members table directly, under the social worker's own access (0172 rules).
    await service();
    await c.query("insert into shared.role_page_access (role, page, level) values ('social_worker', 'bookings.requests', 'edit') on conflict do nothing");
    await as(worker);
    const came = await tryIt("update booking.volunteers set came = false where email = 'two@example.org' returning id");
    const added = await tryIt("insert into booking.volunteers (request_id, position, name, email) values ($1, 50, 'Sample Added', 'added@example.org') returning id", [a.id]);
    const noMail = await tryIt("insert into booking.volunteers (request_id, position, name) values ($1, 51, 'Sample No Mail')", [a.id]);
    check("the social worker marks who came and adds a member with an email; a member without one is refused", came.ok && came.rows.length === 1 && added.ok && !noMail.ok && noMail.code === "23514", came.error ?? added.error ?? noMail.error ?? "accepted without an email");
    await service();
    check("and her marks move the log at once (the switch on)", (await one("select count(*)::int n from ops.volunteer_hours h join ops.volunteers v on v.id = h.volunteer_id where h.booking_request_id = $1 and lower(v.email) = 'two@example.org'", [a.id])).n === 0 && (await one("select count(*)::int n from ops.volunteer_hours h join ops.volunteers v on v.id = h.volunteer_id where h.booking_request_id = $1 and lower(v.email) = 'added@example.org'", [a.id])).n === 1);
  }
  if (chef) {
    await as(chef);
    const sees = await tryIt("select (select count(*)::int from ops.volunteers) people, (select count(*)::int from booking.groups) groups, (select count(*)::int from ops.volunteer_hours) lines");
    check("a role without the Volunteers menu sees no volunteer, no group and no log line", sees.ok && sees.rows[0].people === 0 && sees.rows[0].groups === 0 && sees.rows[0].lines === 0, sees.error ?? JSON.stringify(sees.rows));
  }
  await service();
  const anonGroups = await tryIt("set local role anon; select count(*)::int n from booking.groups");
  await service();
  check("nobody outside reads the groups", !anonGroups.ok || anonGroups.rows?.[0]?.n === 0, JSON.stringify(anonGroups.rows ?? anonGroups.error));
  if (early) check("(the early request's group is separate)", (await one("select count(*)::int n from booking.groups where lower(email) in ('early@example.org', 'group@example.org')")).n === 2);
} catch (e) {
  failures++;
  console.log("FAIL", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `${failures} failed` : "all passed (rolled back)");
process.exit(failures ? 1 : 0);
