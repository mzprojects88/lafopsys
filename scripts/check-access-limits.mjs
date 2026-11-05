// Proves 0130-0132 + Inventory 0071/0072 on a database they are applied to, keeping nothing: one transaction, rolled back.
//   node --env-file=.env.local scripts/check-access-limits.mjs
// Each role is acted out with its own JWT claims, using a real or sample account of that role (names are never printed).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const { pgUrl } = await import("./lib/db-url.mjs");
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
let failures = 0;
const check = (name, ok, note = "") => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${note ? ` (${note})` : ""}`); if (!ok) failures++; };
const owner = async () => { await c.query("reset role"); };
const as = async (id) => {
  await owner();
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, role: "authenticated" })]);
  await c.query("set local role authenticated");
  await c.query("discard plans");
};
/** Runs one statement in a savepoint; true when the database allowed it and it touched a row (or returned one). */
const allowed = async (sql, params = []) => {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, params);
    await c.query("release savepoint s");
    return { ok: (r.rowCount ?? 0) > 0, rows: r.rows };
  } catch (e) {
    await c.query("rollback to savepoint s");
    return { ok: false, error: e.message };
  }
};
try {
  await c.query("begin");
  // A person of each role: real or sample, active or made active inside this rolled-back transaction.
  const person = async (role) => {
    const { rows } = await c.query("select id from shared.staff where role = $1 order by first_name = 'Sample' desc limit 1", [role]);
    if (!rows[0]) throw new Error(`no account with role ${role}`);
    await c.query("update shared.staff set active = true, extra_roles = '{}' where id = $1", [rows[0].id]);
    return rows[0].id;
  };
  const ids = {};
  for (const r of ["driver", "house_staff", "nutritionist", "social_worker", "volunteer", "board", "chef", "partner_viewer", "inventory_lead", "admin", "finance"]) ids[r] = await person(r);
  const [trip] = (await c.query("select id from ops.trips limit 1")).rows;

  // --- trips belong to Transport (0130)
  for (const [role, expected] of [["driver", true], ["social_worker", true], ["admin", true], ["house_staff", false], ["nutritionist", false]]) {
    await as(ids[role]);
    const r = await allowed("update ops.trips set updated_at = now() where id = $1 returning id", [trip.id]);
    check(`${role} ${expected ? "can" : "cannot"} change a trip`, r.ok === expected, r.error?.slice(0, 50));
  }

  // --- the pages (0130), as the database sees them
  await owner();
  const lvl = async (role, page) => (await c.query("select level from shared.role_page_access where role=$1 and page=$2", [role, page])).rows[0]?.level ?? "none";
  const expect = [
    ["driver", "transport.trips", "edit"], ["driver", "transport.fuel", "edit"], ["driver", "transport.report", "view"], ["driver", "house_ops.overview", "view"],
    ["driver", "house_ops.meals", "none"], ["driver", "house_ops.activity_center", "none"], ["driver", "reports.programs", "none"], ["driver", "analytics.dashboard", "none"],
    ["house_staff", "house_ops.activity_center", "edit"], ["house_staff", "house_ops.meals", "view"], ["house_staff", "house_ops.menu", "view"], ["house_staff", "transport.trips", "none"], ["house_staff", "reports.generate", "none"],
  ];
  const wrong = [];
  for (const [role, page, want] of expect) { const got = await lvl(role, page); if (got !== want) wrong.push(`${role} ${page} ${got}`); }
  check("Driver and House Staff pages match the approved table", wrong.length === 0, wrong.join(", "));
  const mod = async (role, module) => (await c.query("select level from shared.module_access where role=$1 and module=$2", [role, module])).rows[0]?.level ?? "none";
  check("Driver's House Operations menu came down to view", (await mod("driver", "house_ops")) === "view");
  check("Driver keeps Transport edit", (await mod("driver", "transport")) === "edit");

  // --- clinical detail (0130)
  const clinical = (await c.query("select role from shared.role_powers where power='clinical_detail' order by role")).rows.map((r) => r.role);
  check("clinical detail only on CEO, Chef, Nutritionist, Office Admin, Social Worker", clinical.join(",") === "ceo,chef,nutritionist,office_admin,social_worker", clinical.join(","));
  await as(ids.volunteer);
  check("a volunteer holds no clinical detail power", (await c.query("select shared.has_power('clinical_detail') p")).rows[0].p === false);

  // --- the place name (0130)
  await owner();
  const place = (await c.query("select transport_places::text t from shared.app_settings limit 1")).rows[0].t;
  check("no place name has a blanked s", !place.includes("Ho pital"));

  // --- ride history (0131): a day's rides appear as the sheet figure; nobody but the sync writes them
  await c.query("insert into ops.sheet_rides (date, to_nch, to_laf) values ('2020-02-03', 4, 2) on conflict (date) do update set to_nch = 4, to_laf = 2");
  const rides = (await c.query("select line, from_sheet from ops.program_impact_range_rows('2020-02-01', '2020-02-29', 'month') where line like 'transport%' order by line")).rows;
  check("rides show as the sheet figure in the Programs report", Number(rides[0]?.from_sheet) === 2 && Number(rides[1]?.from_sheet) === 4, JSON.stringify(rides));
  await as(ids.admin);
  check("the rides table can't be written from the app", !(await allowed("insert into ops.sheet_rides (date, to_nch) values ('2020-02-04', 1) returning date")).ok);
  await as(ids.board);
  await owner();

  // --- AI use statement (0132): pending until approved; each person records only their own acceptance
  const s = (await c.query("select ai_consent_approved a, ai_consent_version v, length(ai_consent_text) n, length(ai_consent_family_text) f from shared.app_settings limit 1")).rows[0];
  check("the statements are in Settings, pending approval", s.a === false && s.n > 100 && s.f > 100);
  await as(ids.volunteer);
  check("a person records their own acceptance", (await allowed("insert into shared.ai_consents (version) values (1) returning version")).ok);
  check("nobody records another person's", !(await allowed("insert into shared.ai_consents (staff_id, version) values ($1, 1) returning version", [ids.board])).ok);
  check("an acceptance can't be changed", !(await allowed("update shared.ai_consents set accepted_at = now() returning version")).ok);
  await as(ids.board);
  check("a person can't read another's acceptance", (await c.query("select count(*) n from shared.ai_consents")).rows[0].n === "0");
  await as(ids.volunteer);
  check("only the admin changes the statement", !(await allowed("update shared.app_settings set ai_consent_approved = true returning id")).ok);

  // --- the six lots and the Finance tasks (Inventory 0071)
  await owner();
  const orphans = (await c.query("select count(*) n from inventory.lots where source_type='donation' and donation_id is null and archived_at is null")).rows[0].n;
  check("no donation lot without a receipt", orphans === "0", `${orphans} left`);
  await as(ids.finance);
  const found = (await c.query("select inventory.in_kind_data_checks() f")).rows[0].f;
  const mismatch = found.filter((f) => f.kind === "gik_value_mismatch").length;
  check("Finance sees the receipts that differ from their stock", mismatch >= 1, `${mismatch} found`);

  // --- the partner (Inventory 0072): view only, no values, and only for partners
  await owner();
  await c.query("insert into inventory.staff_house (staff_id, house_id) values ($1, 'house-laf-main') on conflict (staff_id) do nothing", [ids.partner_viewer]);
  await as(ids.partner_viewer);
  const boxes = (await allowed("select * from inventory.partner_house_stocks()")).rows ?? [];
  check("the partner sees Operations Stocks", boxes.length > 0, `${boxes.length} boxes`);
  const keys = boxes[0] ? Object.keys(boxes[0]) : [];
  check("no value, cost, donor or draw column reaches the partner", !keys.some((k) => /value|cost|donor|draw|used_per_day/.test(k)), keys.join(","));
  check("the partner sees the stock list", ((await allowed("select * from inventory.partner_stock()")).rows ?? []).length > 0);
  check("the partner can't read receipts", (await c.query("select count(*) n from inventory.donation_log")).rows[0].n === "0");
  check("the partner can't change anything", !(await allowed("update inventory.items set name = name returning id")).ok);
  await as(ids.chef);
  check("a staff role gets nothing from the partner function", ((await allowed("select * from inventory.partner_house_stocks()")).rows ?? []).length === 0);
} catch (e) {
  failures++;
  console.error("FAIL", e.message);
} finally {
  await c.query("rollback").catch(() => {});
  await c.end();
}
console.log(failures ? `${failures} failure(s)` : "all checks passed, nothing kept");
process.exitCode = failures ? 1 : 0;
