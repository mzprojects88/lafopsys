const PAGE = 1000;

/**
 * Every row of a query. One request returns at most 1,000 rows (the API's cap), and says nothing
 * when it cuts the rest off: ops.donations reached 997 rows on 2026-10-12. `page` must ask for
 * rows `from`..`to` of a query with a stable order (end the order with the primary key).
 */
export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let at = 0; ; at += PAGE) {
    const { data, error } = await page(at, at + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}
