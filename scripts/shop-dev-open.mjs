// Development only: opens (or closes) the shop on the development database so the order flow can be tried.
//   node --env-file=.env.local scripts/shop-dev-open.mjs [close]
import pg from "pg";
import { pgUrl, isProd } from "./lib/db-url.mjs";

if (isProd() || !pgUrl().includes("kptftyuzrnummbcjakro")) throw new Error("development only");
const open = process.argv[2] !== "close";
const c = new pg.Client({ connectionString: pgUrl(), ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows } = await c.query("update shop.settings set shop_open = $1, pickup_address = case when pickup_address = '' then 'Sample pick-up address (development)' else pickup_address end returning shop_open, hold_minutes", [open]);
await c.end();
console.log(`development shop is now ${rows[0].shop_open ? "OPEN" : "closed"} (unpaid orders hold for ${rows[0].hold_minutes} minutes)`);
