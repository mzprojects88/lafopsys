// Postgres connection for scripts. Dev (default): the current Supabase project.
// Production: run with --env-file=.env.prod.local, which sets SUPABASE_DB_URL to the
// dashboard's Session pooler URI (keep its [YOUR-PASSWORD]) and SUPABASE_DB_PASSWORD.
export function pgUrl(password = process.env.SUPABASE_DB_PASSWORD ?? "") {
  const pw = encodeURIComponent(password);
  const url = process.env.SUPABASE_DB_URL;
  return url
    ? url.replace("[YOUR-PASSWORD]", pw)
    : `postgresql://postgres.kptftyuzrnummbcjakro:${pw}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;
}

/** True when a script is pointed at production (the LAF official project). */
export const isProd = () => Boolean(process.env.SUPABASE_DB_URL);
