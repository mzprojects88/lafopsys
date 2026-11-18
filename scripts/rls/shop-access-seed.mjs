// The Shop's role (Shop Admin) and page levels live in shared tables that development mirrors to production every
// hour. Until production has the Shop migrations (0155, 0157), production's rules refuse those rows, so development
// does not keep them: a check run seeds them inside its own transaction, which is always rolled back.
// Once the migrations are on production, the mirror brings the rows to development and this does nothing new.
import { readFileSync } from "node:fs";

/** Runs the role and page seeds of the Shop migrations (each is "on conflict do nothing") on connection `c`. */
export async function seedShopAccess(c) {
  let ran = 0;
  for (const file of ["0155_shop_catalogue.sql", "0157_shop_fulfilment.sql", "0158_shop_dashboard_card.sql", "0160_shop_customers.sql"]) {
    const sql = readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8");
    for (const m of sql.matchAll(/insert into shared\.(?:roles|role_page_access|role_dashboard_cards)[\s\S]*?on conflict do nothing;/g)) {
      await c.query(m[0]);
      ran++;
    }
  }
  if (ran !== 5) throw new Error(`expected the role seed, three page seeds and the dashboard card seed in the Shop migrations, found ${ran}`);
}
