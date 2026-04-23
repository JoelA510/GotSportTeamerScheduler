import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TTLCache,
  buildEdgeFunctionCacheKey,
  cachedInvoke,
  edgeFunctionCache,
} from '../frontend/src/lib/cache.js';
import { makeOrganization } from './factories/index.js';

/**
 * Wave 6b Task 1 — Frontend TTL cache for Edge Function invocations.
 *
 * These tests prove the four invariants called out in the wave spec:
 *   (a) First call invokes; second call within TTL returns cached (no invoke).
 *   (b) After TTL expires, the invoker is called again.
 *   (c) Different `organization_id` gets a separate cache entry
 *       (NO cross-tenant leak — treated as a security invariant).
 *   (d) Cache miss on fresh mount (shared cache starts cold per key).
 *
 * Plus: error responses are NOT cached (retries work), and invalidation-by-
 * prefix clears an org's entries for post-write invalidation.
 */

describe('buildEdgeFunctionCacheKey', () => {
  it('includes organization_id in the key (cross-tenant safety)', () => {
    const k1 = buildEdgeFunctionCacheKey('fairness-scoring', {
      organization_id: 'org-a',
      persist: false,
    });
    const k2 = buildEdgeFunctionCacheKey('fairness-scoring', {
      organization_id: 'org-b',
      persist: false,
    });
    expect(k1).not.toBe(k2);
    expect(k1).toContain('org-a');
    expect(k2).toContain('org-b');
  });

  it('produces identical keys regardless of param insertion order (stable sort)', () => {
    const k1 = buildEdgeFunctionCacheKey('fairness-scoring', {
      organization_id: 'org-a',
      persist: false,
      nested: { b: 2, a: 1 },
    });
    const k2 = buildEdgeFunctionCacheKey('fairness-scoring', {
      nested: { b: 2, a: 1 },
      persist: false,
      organization_id: 'org-a',
    });
    expect(k1).toBe(k2);
  });

  it('buckets missing organization_id into a distinct `no-org` slot', () => {
    const keyA = buildEdgeFunctionCacheKey('fairness-scoring', { persist: false });
    const keyB = buildEdgeFunctionCacheKey('fairness-scoring', {
      organization_id: 'org-a',
      persist: false,
    });
    expect(keyA).toContain('no-org');
    expect(keyA).not.toBe(keyB);
  });

  it('prefixes with the Edge Function name so different functions do not collide', () => {
    const k1 = buildEdgeFunctionCacheKey('fairness-scoring', { organization_id: 'org-a' });
    const k2 = buildEdgeFunctionCacheKey('auto-scheduler', { organization_id: 'org-a' });
    expect(k1).not.toBe(k2);
    expect(k1.startsWith('fairness-scoring:')).toBe(true);
    expect(k2.startsWith('auto-scheduler:')).toBe(true);
  });
});

describe('cachedInvoke (Wave 6b T1)', () => {
  /** @type {TTLCache} */
  let cache;
  const orgA = makeOrganization({ id: 'org-a' });
  const orgB = makeOrganization({ id: 'org-b' });

  beforeEach(() => {
    cache = new TTLCache({ defaultTtlMs: 60_000, maxEntries: 50 });
  });

  afterEach(() => {
    cache.clear();
    vi.useRealTimers();
  });

  it('(a) first call invokes the Edge Function; second call within TTL returns cached', async () => {
    const invoker = vi
      .fn()
      .mockResolvedValue({ data: { fairnessIndex: 0.87, issues: [] }, error: null });

    const params = { organization_id: orgA.id, persist: false };

    const r1 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params,
      invoker,
      ttlMs: 60_000,
      cache,
    });
    const r2 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params,
      invoker,
      ttlMs: 60_000,
      cache,
    });

    expect(invoker).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
    expect(r1.data.fairnessIndex).toBe(0.87);
  });

  it('(b) after TTL expires, the invoker is called again', async () => {
    vi.useFakeTimers();
    const invoker = vi
      .fn()
      .mockResolvedValueOnce({ data: 'first', error: null })
      .mockResolvedValueOnce({ data: 'second', error: null });

    const params = { organization_id: orgA.id, persist: false };

    const r1 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params,
      invoker,
      ttlMs: 1_000,
      cache,
    });

    // Advance past TTL.
    vi.advanceTimersByTime(1_500);

    const r2 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params,
      invoker,
      ttlMs: 1_000,
      cache,
    });

    expect(invoker).toHaveBeenCalledTimes(2);
    expect(r1.data).toBe('first');
    expect(r2.data).toBe('second');
  });

  it('(c) CROSS-TENANT SAFETY: different organization_id gets a separate cache entry', async () => {
    const invoker = vi.fn().mockImplementation((_name, opts) => {
      // Return a distinct payload per org to prove no bleed.
      return Promise.resolve({
        data: { orgId: opts.body.organization_id, score: 0.5 },
        error: null,
      });
    });

    const r1 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { organization_id: orgA.id, persist: false },
      invoker,
      ttlMs: 60_000,
      cache,
    });
    const r2 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { organization_id: orgB.id, persist: false },
      invoker,
      ttlMs: 60_000,
      cache,
    });

    expect(invoker).toHaveBeenCalledTimes(2);
    expect(r1.data.orgId).toBe('org-a');
    expect(r2.data.orgId).toBe('org-b');

    // Second call for org-a must NOT return org-b's data.
    const r3 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { organization_id: orgA.id, persist: false },
      invoker,
      ttlMs: 60_000,
      cache,
    });
    expect(r3.data.orgId).toBe('org-a');
    // Third call for org-a was a cache hit — still 2 invocations total.
    expect(invoker).toHaveBeenCalledTimes(2);
  });

  it('(d) cache miss on a fresh (empty) cache → invoker is called', async () => {
    const freshCache = new TTLCache({ defaultTtlMs: 60_000, maxEntries: 50 });
    const invoker = vi.fn().mockResolvedValue({ data: 'cold-read', error: null });

    const result = await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { organization_id: orgA.id, persist: false },
      invoker,
      ttlMs: 60_000,
      cache: freshCache,
    });

    expect(invoker).toHaveBeenCalledTimes(1);
    expect(result.data).toBe('cold-read');
  });

  it('does NOT cache error responses (retry goes back to the Edge Function)', async () => {
    const invoker = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error('transient') })
      .mockResolvedValueOnce({ data: 'recovered', error: null });

    const params = { organization_id: orgA.id, persist: false };

    const r1 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params,
      invoker,
      ttlMs: 60_000,
      cache,
    });
    expect(r1.error).toBeTruthy();

    const r2 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params,
      invoker,
      ttlMs: 60_000,
      cache,
    });
    expect(r2.error).toBeNull();
    expect(r2.data).toBe('recovered');
    expect(invoker).toHaveBeenCalledTimes(2);
  });

  it('different function names do not share cache entries even with identical params', async () => {
    const invoker = vi
      .fn()
      .mockImplementation((name) => Promise.resolve({ data: { via: name }, error: null }));

    const params = { organization_id: orgA.id };

    const r1 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params,
      invoker,
      ttlMs: 60_000,
      cache,
    });
    const r2 = await cachedInvoke({
      functionName: 'auto-scheduler',
      params,
      invoker,
      ttlMs: 60_000,
      cache,
    });

    expect(invoker).toHaveBeenCalledTimes(2);
    expect(r1.data.via).toBe('fairness-scoring');
    expect(r2.data.via).toBe('auto-scheduler');
  });

  it('invalidateByPrefix on the shared edgeFunctionCache clears only the given org', async () => {
    // Use the shared instance to prove the EvaluationPanel.jsx invalidation
    // pattern: `fairness-scoring:${orgId}:` targets one org only.
    edgeFunctionCache.clear();

    const invoker = vi
      .fn()
      .mockImplementation((_name, opts) =>
        Promise.resolve({ data: { forOrg: opts.body.organization_id }, error: null })
      );

    await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { organization_id: orgA.id, persist: false },
      invoker,
      ttlMs: 60_000,
      cache: edgeFunctionCache,
    });
    await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { organization_id: orgB.id, persist: false },
      invoker,
      ttlMs: 60_000,
      cache: edgeFunctionCache,
    });

    // Invalidate only org-a.
    edgeFunctionCache.invalidateByPrefix(`fairness-scoring:${orgA.id}:`);

    // org-a should miss; org-b should still hit.
    await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { organization_id: orgA.id, persist: false },
      invoker,
      ttlMs: 60_000,
      cache: edgeFunctionCache,
    });
    await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { organization_id: orgB.id, persist: false },
      invoker,
      ttlMs: 60_000,
      cache: edgeFunctionCache,
    });

    // 2 initial + 1 after invalidation for org-a = 3. org-b stayed cached.
    expect(invoker).toHaveBeenCalledTimes(3);

    // Cleanup the shared singleton so other tests start clean.
    edgeFunctionCache.clear();
  });

  it('changing payload input (new cache key) causes a fresh invocation', async () => {
    const invoker = vi
      .fn()
      .mockResolvedValueOnce({ data: 'scores-for-practice-A', error: null })
      .mockResolvedValueOnce({ data: 'scores-for-practice-B', error: null });

    const base = { organization_id: orgA.id, persist: false };
    const r1 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { ...base, practiceId: 'practice-A' },
      invoker,
      ttlMs: 60_000,
      cache,
    });
    const r2 = await cachedInvoke({
      functionName: 'fairness-scoring',
      params: { ...base, practiceId: 'practice-B' },
      invoker,
      ttlMs: 60_000,
      cache,
    });

    expect(invoker).toHaveBeenCalledTimes(2);
    expect(r1.data).toBe('scores-for-practice-A');
    expect(r2.data).toBe('scores-for-practice-B');
  });
});
