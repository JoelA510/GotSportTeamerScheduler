import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages } from '../frontend/src/lib/pagedFetch.js';

function makeBuilder(pages) {
  // Each call to buildQuery() returns a fresh single-use builder, mirroring
  // PostgREST builder semantics; resolves the next prepared page.
  let call = 0;
  const ranges = [];
  const buildQuery = vi.fn(() => {
    const page = pages[Math.min(call, pages.length - 1)];
    call += 1;
    return {
      order: vi.fn().mockReturnThis(),
      range: vi.fn((from, to) => {
        ranges.push([from, to]);
        return Promise.resolve(page);
      }),
    };
  });
  return { buildQuery, ranges };
}

describe('fetchAllPages', () => {
  it('aggregates pages until a short page arrives', async () => {
    const pageA = Array.from({ length: 3 }, (_, i) => ({ id: i }));
    const pageB = [{ id: 3 }];
    const { buildQuery, ranges } = makeBuilder([
      { data: pageA, error: null },
      { data: pageB, error: null },
    ]);
    const rows = await fetchAllPages(buildQuery, { pageSize: 3 });
    expect(rows).toEqual([...pageA, ...pageB]);
    expect(ranges).toEqual([
      [0, 2],
      [3, 5],
    ]);
  });

  it('handles a row count that is an exact multiple of the page size', async () => {
    const fullPage = Array.from({ length: 2 }, (_, i) => ({ id: i }));
    const { buildQuery } = makeBuilder([
      { data: fullPage, error: null },
      { data: [], error: null },
    ]);
    const rows = await fetchAllPages(buildQuery, { pageSize: 2 });
    expect(rows).toEqual(fullPage);
  });

  it('returns an empty array for an empty table', async () => {
    const { buildQuery } = makeBuilder([{ data: [], error: null }]);
    expect(await fetchAllPages(buildQuery, { pageSize: 5 })).toEqual([]);
  });

  it('throws the PostgREST error from a failing page', async () => {
    const { buildQuery } = makeBuilder([{ data: null, error: new Error('rls denied') }]);
    await expect(fetchAllPages(buildQuery)).rejects.toThrow('rls denied');
  });

  it('builds a fresh query per page (builders are single-use)', async () => {
    const full = Array.from({ length: 2 }, (_, i) => ({ id: i }));
    const { buildQuery } = makeBuilder([
      { data: full, error: null },
      { data: [], error: null },
    ]);
    await fetchAllPages(buildQuery, { pageSize: 2 });
    expect(buildQuery).toHaveBeenCalledTimes(2);
  });
});
