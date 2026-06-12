import { describe, it, expect, vi } from 'vitest';
import { mapInChunks, DEFAULT_RPC_CHUNK } from '../frontend/src/utils/asyncChunks.js';

describe('mapInChunks', () => {
  it('maps every item and preserves input order', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await mapInChunks(items, async (n) => n * 2, 8);
    expect(results).toEqual(items.map((n) => n * 2));
  });

  it('returns an empty array for empty input without calling the mapper', async () => {
    const mapper = vi.fn();
    expect(await mapInChunks([], mapper)).toEqual([]);
    expect(mapper).not.toHaveBeenCalled();
  });

  it('never runs more than chunkSize mappers concurrently', async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await mapInChunks(
      items,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;
      },
      8
    );
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('a throwing mapper rejects and stops later chunks from starting', async () => {
    const seen = [];
    const items = Array.from({ length: 12 }, (_, i) => i);
    await expect(
      mapInChunks(
        items,
        async (n) => {
          seen.push(n);
          if (n === 1) throw new Error('boom');
        },
        4
      )
    ).rejects.toThrow('boom');
    // Chunk 1 (items 0-3) ran; chunks 2 and 3 never started.
    expect(seen.length).toBeLessThanOrEqual(4);
  });

  it('defaults to the documented free-tier chunk size', () => {
    expect(DEFAULT_RPC_CHUNK).toBe(8);
  });
});
