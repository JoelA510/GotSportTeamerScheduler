/**
 * Bounded-concurrency mapping for per-row RPC fan-outs. Strictly sequential
 * loops are slow and unbounded Promise.all brown-outs the free tier's small
 * pooled-connection budget, so batch fan-outs run in fixed-size chunks
 * (docs/LESSONS_LEARNED.md #15).
 */
export const DEFAULT_RPC_CHUNK = 8;

/**
 * Map `items` through async `mapper`, `chunkSize` at a time, preserving input
 * order in the returned results. A mapper that throws rejects the current
 * chunk and stops later chunks from starting — callers that want
 * fail-fast semantics should throw from the mapper; callers that want a
 * per-item success tally should catch inside the mapper and return a marker.
 *
 * @template TItem, TResult
 * @param {TItem[]} items
 * @param {(item: TItem) => Promise<TResult>} mapper
 * @param {number} [chunkSize]
 * @returns {Promise<TResult[]>}
 */
export async function mapInChunks(items, mapper, chunkSize = DEFAULT_RPC_CHUNK) {
  const results = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunkResults = await Promise.all(
      items.slice(i, i + chunkSize).map((item) => mapper(item))
    );
    results.push(...chunkResults);
  }
  return results;
}
