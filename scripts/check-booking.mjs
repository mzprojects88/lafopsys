// Proves the LAF Activity Center Bookings database (0172), writing nothing that stays: everything runs in one
// transaction that is rolled back. With --with-migration the 0172 file is loaded inside that transaction first.
//   node --env-file=.env.local scripts/check-booking.mjs [--with-migration] [--fresh]
// --fresh (with --with-migration) first drops the booking schema inside the transaction, so the files are proven
// as a database that never had them will run them: that is production's first apply.
// Development only. Made-up requestors (example.org); no real person, no email is sent.
import { readFileSync } from "node:fs";
import pg from "pg";
import { isProd, pgUrl } from "./lib/db-url.mjs";

if (isProd()) throw new Error("development only");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
let failures = 0;
const check = (name, ok, note = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : note ? " | " + String(note).slice(0, 170) : ""}`); if (!ok) failures++; };
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
const item = (activity, start, end, more = {}) => ({ activity, source: "list", purpose: "To bring joy", who: "patients", ages: "4 to 12", gender: "all", start_time: start, end_time: end, materials: "Books", ...more });
let n = 0;
const payload = (place, date, more = {}) => ({
  place_id: place, date, start_time: "10:00", requestor_name: "Sample Volunteers Inc.", requestor_kind: "company", contact_person: "Sample Person",
  email: `group${++n}@example.org`, mobile: "0917 000 0000", volunteers_count: 5, has_minors: false,
  items: [item("Book Reading", "10:00", "11:00"), item("Drawing", "11:00", "12:00")], agree_guidelines: true, agree_privacy: true, ...more,
});
const request = (p, caller = "caller-a") => tryIt("select booking.web_request($1::jsonb, $2) r", [JSON.stringify(p), caller]);

try {
  await c.query("begin");
  if (process.argv.includes("--with-migration")) {
    if (process.argv.includes("--fresh")) await c.query("drop schema if exists booking cascade");
    for (const file of ["0172_booking_core.sql", "0173_booking_links_deferrable.sql", "0175_booking_site_url.sql", "0176_booking_dated_plan.sql", "0177_booking_calendar_and_sessions.sql", "0178_booking_reminders.sql", "0180_booking_staff_request.sql"]) await c.query(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
    const [links] = await q("select count(*)::int n, count(*) filter (where not condeferrable)::int fixed from pg_constraint where contype = 'f' and connamespace = 'booking'::regnamespace");
    check(`every link of the booking tables can be deferred (${links.n} links)`, links.n >= 14 && links.fixed === 0, JSON.stringify(links));
  }

  // ---- what the foundation starts with ----
  const place = await one("select id, name from booking.places where open order by sort limit 1");
  const slots = await q("select weekday, start_time::text s, end_time::text e from booking.slots where place_id = $1 and active order by weekday", [place.id]);
  check("one place, open, with Monday, Tuesday, Thursday and Friday 10:00 to 12:00", slots.map((x) => x.weekday).join() === "1,2,4,5" && slots.every((x) => x.s === "10:00:00" && x.e === "12:00:00"), JSON.stringify(slots));
  const st = await one("select min_days_ahead a, max_days_ahead b, max_volunteers v, max_open_requests o, names_due_days d from booking.settings");
  check("defaults: 14 days ahead at the earliest, 60 at the latest, 10 volunteers, 2 open requests, names due 3 days before", st.a === 14 && st.b === 60 && st.v === 10 && st.o === 2 && st.d === 3, JSON.stringify(st));
  const site = await tryIt("update booking.settings set site_url = 'javascript:alert(1)'");
  check("the booking page's address starts as book.littlearkfoundation.org and only a plain web address is accepted", (await one("select site_url from booking.settings")).site_url === "https://book.littlearkfoundation.org" && !site.ok && site.code === "23514", site.error ?? "accepted");

  // ---- the public doors ----
  const form = (await one("select booking.web_form() f")).f;
  check("the form gets the open place, the limits, the texts and the activity list", form.places.length === 1 && form.settings.maxVolunteers === 10 && form.settings.guidelines.length > 100 && form.activities.includes("Book Reading") && form.activities.includes("Storytelling"));

  const states = await q("select day::text, state from booking.slot_states($1, booking.today(), booking.today() + 90)", [place.id]);
  const open = states.filter((s) => s.state === "open").map((s) => s.day);
  check("slots sooner than 14 days are too soon, later than 60 too far, the rest open", states.some((s) => s.state === "too_soon") && states.some((s) => s.state === "too_far") && open.length >= 20, `${open.length} open`);
  const [d1, d2, d3, d4] = open;
  const month = (await one("select booking.web_availability($1, $2::date) a", [place.id, d1])).a;
  check("the month view names nobody: date, start, end and state only", month.length > 0 && month.every((s) => Object.keys(s).sort().join() === "date,end,start,state"));

  const first = await request(payload(place.id, d1));
  const made = first.ok ? first.rows[0].r : {};
  check("a request is filed: a Request ID with a random part and a running number", first.ok && /^LAF-AC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(made.ref) && /^LAF-ACB-\d{4}-\d{4}$/.test(made.seqNo), first.error);
  check("activities from LAF's list, not from an NCH-approved plan, mark it off plan", made.offPlan === true);
  check("the slot is held: it now reads pending approval", (await one("select state from booking.slot_states($1, $2::date, $2::date)", [place.id, d1])).state === "pending");
  const second = await request(payload(place.id, d1));
  check("a second group can't take the same slot", !second.ok && /just been asked for/.test(second.error), second.error ?? "accepted");

  const bad = async (name, more, pattern) => { const r = await request(payload(place.id, d2, more)); check(name, !r.ok && pattern.test(r.error), r.error ?? "accepted"); };
  await bad("four activities are refused (1 to 3)", { items: [item("Book Reading", "10:00", "10:30"), item("Drawing", "10:30", "11:00"), item("Storytelling", "11:00", "11:30"), item("Film Showing", "11:30", "12:00")] }, /1 to 3 activities/);
  await bad("an activity outside the slot is refused", { items: [item("Book Reading", "09:30", "10:30")] }, /fit inside the slot \(10:00 AM to 12:00 PM\)/);
  await bad("activities that overlap are refused", { items: [item("Book Reading", "10:00", "11:00"), item("Drawing", "10:30", "11:30")] }, /starts before the one before it has ended/);
  await bad("an activity that ends before it starts is refused", { items: [item("Book Reading", "11:00", "10:00")] }, /end time must be after/);
  await bad("more volunteers than the limit is refused", { volunteers_count: 11 }, /1 to 10 volunteers/);
  await bad("both boxes must be ticked", { agree_privacy: false }, /tick both boxes/);
  await bad("an email we can't write to is refused", { email: "not-an-email" }, /email address/);
  await bad("an activity that is neither on the list nor suggested is refused", { items: [item("Running Race", "10:00", "11:00")] }, /from the list, or suggest one/);
  await bad("a weekday with no slot is refused", { date: (await one("select (d)::date::text d from generate_series(booking.today() + 20, booking.today() + 27, interval '1 day') d where extract(dow from d) = 3 limit 1")).d }, /not offered on that day/);
  const soon = states.find((s) => s.state === "too_soon")?.day;
  const tooSoon = await request(payload(place.id, soon));
  check("a day sooner than 14 days ahead is refused", !tooSoon.ok && /at least 14 days ahead/.test(tooSoon.error), tooSoon.error ?? "accepted");
  const long = await request(payload(place.id, d2, { requestor_name: "x".repeat(300) }));
  check("a name far too long is refused with a plain message", !long.ok && /missing or too long/.test(long.error), long.error ?? "accepted");

  const sameEmail = { email: "same@example.org" };
  const e1 = await request(payload(place.id, d2, sameEmail));
  const e2 = await request(payload(place.id, d3, sameEmail));
  const e3 = await request(payload(place.id, d4, sameEmail));
  check("one email address may hold 2 open requests, not a third", e1.ok && e2.ok && !e3.ok && /already has 2 requests/.test(e3.error), e3.error ?? "accepted");

  const miss = (await one("select booking.web_lookup('LAF-AC-AAAA-AAAA', 'caller-b') v")).v;
  const seen = (await one("select booking.web_lookup($1, 'caller-b') v", [made.ref.toLowerCase().replace(/-/g, " - ")])).v;
  check("an unknown Request ID shows nothing", miss === null);
  check("the right one shows the booking, however it is typed; contacts masked; nothing for approved bookings yet", seen?.status === "pending" && seen.items.length === 2 && /^g\*\*\*@example\.org$/.test(seen.email) && /^\*+000$/.test(seen.mobile) && seen.approved === null && seen.canEditNames === false, JSON.stringify(seen)?.slice(0, 200));

  // ---- staff ----
  const worker = await one("select id from shared.staff where active and role = 'social_worker' order by created_at limit 1");
  const viewer = await one("select id from shared.staff where active and role = 'finance' order by created_at limit 1");
  const outsider = await one("select id from shared.staff where active and role in ('driver', 'chef', 'house_staff') order by created_at limit 1");
  // The rows that open the pages are not in 0172 (they would stop the hourly copy): seeded here, rolled back with the rest.
  // As 0174 does on production: page rows only, and the menu's level follows them by itself (0093).
  await c.query(`insert into shared.role_page_access (role, page, level)
    select r.role, p.page, r.level from (values ('bookings.requests'), ('bookings.plan'), ('bookings.settings')) p(page)
    cross join (values ('social_worker', 'edit'), ('office_admin', 'edit'), ('finance', 'view'), ('ceo', 'view')) r(role, level)
    where exists (select 1 from shared.roles where key = r.role) on conflict do nothing`);
  const levels = await q("select role, level from shared.module_access where module = 'bookings' order by role");
  check("page rows give the menu its level: Social Worker and Office Admin edit, Accounting and the CEO view", levels.map((l) => `${l.role}=${l.level}`).join() === "ceo=view,finance=view,office_admin=edit,social_worker=edit", JSON.stringify(levels));
  // Each account stands for its own role alone here: extra roles and personal overrides are set aside (rolled back).
  for (const who of [worker, viewer, outsider]) {
    if (!who) continue;
    await c.query("update shared.staff set extra_roles = '{}' where id = $1", [who.id]);
    await c.query("delete from shared.staff_module_access where staff_id = $1", [who.id]);
  }
  await c.query("update booking.places set coordinator_name = 'Sample Coordinator', coordinator_phone = '0917 111 1111', instructions = 'Sign the logbook at Gate 2.' where id = $1", [place.id]);

  if (worker) {
    await as(worker.id);
    check("a signed-in staff member can't use the public doors directly", !(await tryIt("select booking.web_form()")).ok && !(await tryIt("select booking.web_request('{}'::jsonb, 'x')")).ok);
    const reqRow = await one("select id, status, off_plan from booking.requests where ref = $1", [made.ref]);
    check("the social worker reads the request", reqRow?.status === "pending");
    const noNote = await tryIt("select booking.decide($1, 'approve', '{}'::jsonb) v", [reqRow.id]);
    check("an off-plan request can't be approved before the NCH coordination is recorded", !noNote.ok && /Record who at NCH you coordinated with/.test(noNote.error), noNote.error ?? "approved");
    const yes = await tryIt("select booking.decide($1, 'approve', $2::jsonb) v", [reqRow.id, JSON.stringify({ nch_contact: "Sample Nurse", nch_coordinated_at: new Date().toISOString(), nch_notes: "Agreed by phone.", instructions: "Bring a valid ID." })]);
    check("with who and when recorded, she approves it", yes.ok && yes.rows[0].v.status === "approved", yes.error);
    const note = await tryIt("update booking.requests set staff_note = 'Called to confirm.' where id = $1 returning staff_note", [reqRow.id]);
    const sneak = await tryIt("update booking.requests set status = 'completed' where id = $1", [reqRow.id]);
    check("she keeps the notes by hand, but a status changes only through the steps", note.ok && !sneak.ok && sneak.code === "42501", sneak.error ?? "the status was changed by hand");
    const second2 = await one("select id from booking.requests where email = 'same@example.org' and date = $1::date", [d2]);
    const noReason = await tryIt("select booking.decide($1, 'decline', '{}'::jsonb)", [second2.id]);
    const declined = await tryIt("select booking.decide($1, 'decline', $2::jsonb) v", [second2.id, JSON.stringify({ reason: "The hospital has an event that day." })]);
    check("declining needs a reason, and the reason is kept", !noReason.ok && declined.ok && declined.rows[0].v.declineReason === "The hospital has an event that day.", noReason.error ?? declined.error);
    await service();
    check("a declined request frees its slot", (await one("select state from booking.slot_states($1, $2::date, $2::date)", [place.id, d2])).state === "open");
    await as(worker.id);
    const third = await one("select id, date::text d from booking.requests where email = 'same@example.org' and date = $1::date", [d3]);
    const taken = await tryIt("select booking.decide($1, 'move', $2::jsonb)", [third.id, JSON.stringify({ date: d1, start_time: "10:00" })]);
    const moved = await tryIt("select booking.decide($1, 'move', $2::jsonb) v", [third.id, JSON.stringify({ date: d2, start_time: "10:00" })]);
    check("a booking can't be moved into a taken slot, and moves into a free one", !taken.ok && /not free/.test(taken.error) && moved.ok && moved.rows[0].v.date === d2, taken.error ?? moved.error);
    const early = await tryIt("select booking.decide($1, 'complete', $2::jsonb)", [reqRow.id, JSON.stringify({ children: 12, volunteers: 5, hours: 2 })]);
    check("a visit can't be closed before its day", !early.ok && /has not happened yet/.test(early.error), early.error ?? "completed");
    // What she keeps by hand on the Activity Plan and Settings pages (the pages write these rows directly).
    const madePlan = await tryIt("insert into booking.plans (place_id, month, created_by) values ($1, (date_trunc('month', $2::date) + interval '4 months')::date, $3) returning id", [place.id, d1, worker.id]);
    const planRow = madePlan.ok ? madePlan.rows[0].id : null;
    const addAct = await tryIt("insert into booking.plan_items (plan_id, activity, on_date, start_time, end_time) select id, 'Sample Activity', month + 2, '10:00', '11:00' from booking.plans where id = $1 returning id", [planRow]);
    const wrongMonth = await tryIt("insert into booking.plan_items (plan_id, activity, on_date) select id, 'Sample Activity', (month + interval '1 month')::date from booking.plans where id = $1", [planRow]);
    const badTime = await tryIt("insert into booking.plan_items (plan_id, activity, on_date, start_time, end_time) select id, 'Sample Activity', month, '11:00', '10:00' from booking.plans where id = $1", [planRow]);
    check("an activity of a plan must fall inside the plan's month, and end after it starts", addAct.ok && !wrongMonth.ok && wrongMonth.code === "23514" && !badTime.ok && badTime.code === "23514", wrongMonth.error ?? badTime.error ?? addAct.error ?? "accepted");
    const sent = await tryIt("update booking.plans set status = 'submitted', submitted_on = booking.today() where id = $1 returning status", [planRow]);
    const noDate = await tryIt("update booking.plans set status = 'approved' where id = $1", [planRow]);
    const okd = await tryIt("update booking.plans set status = 'approved', approved_on = booking.today(), approved_by = 'Sample Head Nurse' where id = $1 returning status", [planRow]);
    check("she keeps the Activity Plan: starts it, adds an activity, marks it sent, records NCH's approval (never without its date)", madePlan.ok && addAct.ok && sent.ok && !noDate.ok && okd.ok && okd.rows[0]?.status === "approved", madePlan.error ?? addAct.error ?? sent.error ?? okd.error ?? "approved without a date");
    const setIt = await tryIt("update booking.settings set reply_days = 4, site_url = 'https://example.org' returning reply_days");
    const slotIt = await tryIt("insert into booking.slots (place_id, weekday, start_time, end_time) values ($1, 3, '14:00', '15:00') returning id", [place.id]);
    const closeIt = await tryIt("insert into booking.closures (place_id, date_from, date_to, reason) values (null, $1::date, $1::date, 'Check') returning id", [open[9]]);
    const typeIt = await tryIt("insert into booking.activity_types (name) values ('Sample Check Activity') returning id");
    check("she changes Settings: the limits and the address, a slot, a closed date, the activity list", setIt.ok && setIt.rows[0]?.reply_days === 4 && slotIt.ok && closeIt.ok && typeIt.ok, setIt.error ?? slotIt.error ?? closeIt.error ?? typeIt.error ?? "no settings row changed");
    // Staff file a booking for someone who phoned or walked in (0180).
    const lateDay = states.filter((s) => s.state === "too_soon").at(-1)?.day;
    const phone = await tryIt("select booking.staff_request($1::jsonb) r", [JSON.stringify(payload(place.id, lateDay, { email: "", channel: "phone" }))]);
    check("staff file a phone request: no email address needed, and a day inside the 14 days may be taken", phone.ok && /^LAF-AC-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(phone.rows[0].r.ref), phone.error);
    const filed = phone.ok ? await one("select r.channel, r.filed_by, r.email, r.status, e.actor, e.by_requestor, e.detail from booking.requests r join booking.events e on e.request_id = r.id and e.action = 'requested' where r.id = $1", [phone.rows[0].r.id]) : {};
    check("it is kept as a phone request with who filed it, and waits for approval like any other", filed.channel === "phone" && filed.filed_by === worker.id && filed.email === null && filed.status === "pending" && filed.actor === worker.id && filed.by_requestor === false && /^Filed by staff for a phone request\./.test(filed.detail), JSON.stringify(filed));
    const twice = await tryIt("select booking.staff_request($1::jsonb) r", [JSON.stringify(payload(place.id, lateDay, { channel: "walk_in" }))]);
    const badMail = await tryIt("select booking.staff_request($1::jsonb) r", [JSON.stringify(payload(place.id, d3, { email: "not-an-email", channel: "walk_in" }))]);
    const noTicks = await tryIt("select booking.staff_request($1::jsonb) r", [JSON.stringify(payload(place.id, d3, { agree_privacy: false }))]);
    check("the rules still hold for staff: one group per slot, a real address when one is given, and the two confirmations", !twice.ok && /asked for by another group/.test(twice.error) && !badMail.ok && /email address/.test(badMail.error) && !noTicks.ok && /tick both boxes/.test(noTicks.error), twice.error ?? badMail.error ?? noTicks.error ?? "accepted");
  } else console.log("skip the social worker's checks (none active on development)");

  await service();
  const after = (await one("select booking.web_lookup($1, 'caller-b') v", [made.ref])).v;
  check("once approved, the look-up shows the instructions and who to coordinate with", !worker || (after.status === "approved" && after.approved?.coordinatorName === "Sample Coordinator" && after.approved?.instructions === "Sign the logbook at Gate 2." && after.approved?.bookingInstructions === "Bring a valid ID." && after.canEditNames === true), JSON.stringify(after?.approved));
  if (worker) {
    const names = await tryIt("select booking.web_names($1, $2::jsonb, 'caller-b') v", [made.ref, JSON.stringify(["Sample One", "Sample Two", "Sample Three"])]);
    const tooMany = await tryIt("select booking.web_names($1, $2::jsonb, 'caller-b') v", [made.ref, JSON.stringify(["A A", "B B", "C C", "D D", "E E", "F F"])]);
    check("the group gives its volunteers' names, never more than it booked for", names.ok && names.rows[0].v.names.length === 3 && !tooMany.ok && /for 5 volunteers/.test(tooMany.error), names.error ?? tooMany.error ?? "six names accepted");
    const cancelled = await tryIt("select booking.web_cancel($1, 'caller-b') v", [made.ref]);
    check("the group can cancel its own booking, which frees the slot", cancelled.ok && cancelled.rows[0].v.status === "cancelled" && (await one("select state from booking.slot_states($1, $2::date, $2::date)", [place.id, d1])).state === "open", cancelled.error);
  }

  if (viewer) {
    await as(viewer.id);
    const rows = await tryIt("select count(*)::int n from booking.requests");
    const act = await tryIt("select booking.decide((select id from booking.requests limit 1), 'cancel', '{}'::jsonb)");
    check("Accounting sees the requests but can't act on them", rows.ok && rows.rows[0].n >= 3 && !act.ok && act.code === "42501", act.error ?? "it acted");
    const vAdd = await tryIt("select booking.staff_request($1::jsonb) r", [JSON.stringify(payload(place.id, d4, { channel: "phone" }))]);
    const vCore = await tryIt("select booking.file_request($1::jsonb, 'x', null)", [JSON.stringify(payload(place.id, d4))]);
    check("nor file a booking for someone, and nobody signed in can reach the rules' core directly", !vAdd.ok && vAdd.code === "42501" && !vCore.ok && vCore.code === "42501", vAdd.error ?? vCore.error ?? "accepted");
    const vPlan = await tryIt("insert into booking.plans (place_id, month) values ($1, date '2031-01-01') returning id", [place.id]);
    const vItem = await tryIt("delete from booking.plan_items returning id");
    const vSet = await tryIt("update booking.settings set reply_days = 9 returning reply_days");
    const vNote = await tryIt("update booking.requests set staff_note = 'x' returning id");
    check("and can't change a plan, Settings or a request's notes", !vPlan.ok && (!vItem.ok || vItem.rows.length === 0) && (!vSet.ok || vSet.rows.length === 0) && (!vNote.ok || vNote.rows.length === 0), JSON.stringify({ plan: vPlan.ok, items: vItem.rows?.length, settings: vSet.rows?.length, notes: vNote.rows?.length }));
  } else console.log("skip the viewer's checks (no active finance account on development)");
  if (outsider) {
    await as(outsider.id);
    const rows = await tryIt("select count(*)::int n from booking.requests");
    const hits = await tryIt("select count(*)::int n from booking.web_hits");
    check("a role without the Bookings page sees no request, and nobody reads the door log", rows.ok && rows.rows[0].n === 0 && (!hits.ok || hits.rows[0].n === 0), JSON.stringify(rows.rows ?? rows.error));
  }

  // ---- the Activity Plan, closures, holidays, limits ----
  await service();
  const plan = await one("insert into booking.plans (place_id, month, status, submitted_on, approved_on, approved_by) values ($1, date_trunc('month', $2::date)::date, 'approved', booking.today(), booking.today(), 'Sample Head Nurse') returning id", [place.id, d4]);
  const planItem = await one("insert into booking.plan_items (plan_id, activity, purpose, participants, materials, on_date, start_time, end_time) values ($1, 'Christmas Card Making', 'A keepsake for families', 'Patients and carers', 'Card, crayons', $2::date, '10:00', '11:00') returning id", [plan.id, d4]);
  const form2 = (await one("select booking.web_form() f")).f;
  check("an approved plan's activities are offered on the form", form2.plans.some((p) => p.items.some((i) => i.activity === "Christmas Card Making")));
  const onPlan = await request(payload(place.id, d4, { items: [item("anything", "10:00", "11:00", { source: "plan", plan_item_id: planItem.id })] }), "caller-c");
  check("a request for a plan activity is not off plan, and takes the plan's own name", onPlan.ok && onPlan.rows[0].r.offPlan === false && (await one("select activity from booking.request_items where request_id = $1", [onPlan.rows[0].r.id])).activity === "Christmas Card Making", onPlan.error);
  const planned = form2.plans.flatMap((p) => p.items).find((i) => i.id === planItem.id);
  check("the booking page is given the plan activity's day and times", planned?.onDate === d4 && planned.start === "10:00" && planned.end === "11:00", JSON.stringify(planned));
  const otherDay = open.find((x) => x.slice(0, 7) === d4.slice(0, 7) && x > d4 && ![open[6], open[7], open[9]].includes(x));
  if (otherDay) {
    const wrongDay = await request(payload(place.id, otherDay, { items: [item("anything", "10:00", "11:00", { source: "plan", plan_item_id: planItem.id })] }), "caller-d");
    check("the same plan activity on another day does not count as planned: it is refused, to be chosen again", !wrongDay.ok && /not in the approved plan for that day/.test(wrongDay.error), wrongDay.error ?? "accepted");
  } else console.log("skip the other-day check (no other open day in that month)");
  if (worker) {
    await as(worker.id);
    const direct = await tryIt("select booking.decide($1, 'approve', '{}'::jsonb) v", [onPlan.rows[0].r.id]);
    check("and it is approved without a coordination note", direct.ok && direct.rows[0].v.status === "approved", direct.error);
    await service();
  }
  const free = open[6];
  await c.query("insert into booking.closures (place_id, date_from, date_to, reason) values ($1, $2::date, $2::date, 'Hospital event')", [place.id, free]);
  check("a closed date reads closed", (await one("select state from booking.slot_states($1, $2::date, $2::date)", [place.id, free])).state === "closed");
  const hol = open[7];
  await c.query("insert into ops.calendar_events (date, title, is_holiday, source) values ($1::date, 'Check holiday', true, 'app')", [hol]);
  check("a holiday on the Calendar closes the slot by itself", (await one("select state from booking.slot_states($1, $2::date, $2::date)", [place.id, hol])).state === "holiday");
  // ---- what a booking leaves on the Calendar and in the Activity Center sessions (0177) ----
  // Those two tables are copied to production every hour; everything here is inside the rolled-back transaction.
  if (worker && onPlan.ok) {
    const quiet = await one("select calendar_event_id, session_id from booking.requests where id = $1", [onPlan.rows[0].r.id]);
    check("with the switch off (as on development), an approved booking writes nothing outside the booking tables", (await one("select feeds_ops from booking.settings")).feeds_ops === false && quiet.calendar_event_id === null && quiet.session_id === null, JSON.stringify(quiet));
    await c.query("update booking.settings set feeds_ops = true");
    const coordinated = JSON.stringify({ nch_contact: "Sample Nurse", nch_coordinated_at: new Date().toISOString() });
    const fed = await request(payload(place.id, open[10]), "caller-e");
    const fedId = fed.ok ? fed.rows[0].r.id : null;
    await as(worker.id);
    await tryIt("select booking.decide($1, 'approve', $2::jsonb)", [fedId, coordinated]);
    await service();
    const ev = await one("select e.date::text d, e.time, e.title, e.program, e.source, e.venue from booking.requests r join ops.calendar_events e on e.id = r.calendar_event_id where r.id = $1", [fedId]);
    check("with it on, an approved booking is on the Calendar under LAF Activity Center, with its day, time and activities", ev?.d === open[10] && ev.time === "10:00 AM - 12:00 PM" && ev.program === "activity_center" && ev.source === "app" && ev.title === "Sample Volunteers Inc.: Book Reading, Drawing" && ev.venue === place.name, fed.error ?? JSON.stringify(ev));
    await as(worker.id);
    await tryIt("select booking.decide($1, 'move', $2::jsonb)", [fedId, JSON.stringify({ date: open[11], start_time: "10:00" })]);
    await service();
    check("moving the booking moves its Calendar entry", (await one("select e.date::text d from booking.requests r join ops.calendar_events e on e.id = r.calendar_event_id where r.id = $1", [fedId]))?.d === open[11]);
    await c.query("update booking.requests set date = booking.today() - 1 where id = $1", [fedId]); // the day comes
    await as(worker.id);
    const recorded = await tryIt("select booking.decide($1, 'complete', $2::jsonb)", [fedId, JSON.stringify({ children: 12, volunteers: 5, hours: 2 })]);
    await service();
    const ses = await one("select s.participants, s.volunteer_count, s.hours::float h, s.site, s.source, s.facilitator, s.title from booking.requests r join ops.activity_sessions s on s.id = r.session_id where r.id = $1", [fedId]);
    check("a recorded visit becomes an Activity Center session with the children, volunteers and hours", recorded.ok && ses?.participants === 12 && ses.volunteer_count === 5 && ses.h === 2 && ses.site === "NCH" && ses.source === "app" && ses.facilitator === "Sample Volunteers Inc.", recorded.error ?? JSON.stringify(ses));
    const gone = await request(payload(place.id, open[12]), "caller-e");
    await as(worker.id);
    await tryIt("select booking.decide($1, 'approve', $2::jsonb)", [gone.ok ? gone.rows[0].r.id : null, coordinated]);
    await service();
    const before = (await one("select calendar_event_id e from booking.requests where id = $1", [gone.rows[0].r.id])).e;
    await tryIt("select booking.web_cancel($1, 'caller-e')", [gone.rows[0].r.ref]);
    check("a booking the group cancels leaves the Calendar", before !== null && (await one("select count(*)::int n from ops.calendar_events where id = $1", [before])).n === 0 && (await one("select calendar_event_id e from booking.requests where id = $1", [gone.rows[0].r.id])).e === null);
  }

  let blocked = null;
  for (let i = 0; i < 32 && !blocked; i++) { const r = await tryIt("select booking.web_lookup('LAF-AC-ZZZZ-ZZZZ', 'caller-flood')"); if (!r.ok) blocked = { at: i + 1, ...r }; }
  check("a caller guessing Request IDs is stopped after 30 tries in an hour", blocked?.at === 31 && blocked.code === "53400", JSON.stringify(blocked));
  const trail = await q("select action from booking.events where request_id = (select id from booking.requests where ref = $1) order by at", [made.ref]);
  check("every step is on the request's trail", !worker || trail.map((t) => t.action).join() === "requested,approved,names,cancelled", trail.map((t) => t.action).join());
} catch (e) {
  failures++;
  console.log("FAIL", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `${failures} failed` : "all passed (rolled back)");
process.exit(failures ? 1 : 0);
