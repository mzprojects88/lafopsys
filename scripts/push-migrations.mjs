// Applies pending supabase/migrations/*.sql to the live shared project via
// the Session Pooler (the direct host is IPv6-only and unreachable from this
// network -- see the connection gotcha in project memory). Never prints the
// db-url (it contains the DB password) to stdout/stderr.
//
// Usage:
//   node --env-file=.env.local scripts/push-migrations.mjs --dry-run
//   node --env-file=.env.local scripts/push-migrations.mjs

import { pgUrl } from "./lib/db-url.mjs";
import { spawnSync } from "node:child_process";

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD in .env.local.");
  process.exit(1);
}

const dbUrl = pgUrl(password);

const dryRun = process.argv.includes("--dry-run");
const args = ["supabase", "db", "push", "--db-url", dbUrl];
if (dryRun) args.push("--dry-run");

const result = spawnSync("npx", args, { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
