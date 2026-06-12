/**
 * Run a PostgREST query to completion in fixed-size pages. Un-ranged selects
 * are silently truncated at the server-side row cap (~1000 rows on hosted
 * Supabase), so any "fetch the whole table" read must page until a short
 * page arrives.
 *
 * `buildQuery` must return a fresh filter builder on every call (builders
 * are single-use); keeping the literal `.select()` string at the call site
 * also preserves checkJs row typing.
 *
 * @param {() => any} buildQuery - returns a fresh `.from(...).select(...).eq(...)` builder
 * @param {{ pageSize?: number, orderBy?: string }} [options]
 * @returns {Promise<any[]>}
 */
export async function fetchAllPages(buildQuery, { pageSize = 1000, orderBy = 'id' } = {}) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery()
      .order(orderBy)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}
