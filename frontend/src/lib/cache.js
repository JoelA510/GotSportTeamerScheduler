/**
 * In-memory TTL cache — Phase 9 Production Hardening
 *
 * A lightweight caching layer for dashboard data to enforce the 200ms
 * interaction ceiling. No external dependencies — uses a plain Map with
 * TTL-based expiration and optional stale-while-revalidate support.
 *
 * Usage:
 *   import { dashboardCache } from '../lib/cache.js';
 *
 *   // Set with 30s TTL
 *   dashboardCache.set('teams:org-123', teamsData, { ttlMs: 30_000 });
 *
 *   // Get (returns null if expired)
 *   const cached = dashboardCache.get('teams:org-123');
 *
 *   // Get-or-fetch pattern
 *   const data = await dashboardCache.getOrFetch('teams:org-123', fetchTeams, { ttlMs: 30_000 });
 */

/** @typedef {{ data: any, expiresAt: number, staleAt: number }} CacheEntry */

class TTLCache {
  constructor({ defaultTtlMs = 30_000, maxEntries = 200 } = {}) {
    /** @type {Map<string, CacheEntry>} */
    this._store = new Map();
    this._defaultTtlMs = defaultTtlMs;
    this._maxEntries = maxEntries;
  }

  /**
   * Store a value with an optional TTL.
   * @param {string} key
   * @param {any} data
   * @param {Object} [options]
   * @param {number} [options.ttlMs]  Time-to-live in ms (default: 30s).
   * @param {number} [options.staleTtlMs]  Extra time data is serveable as "stale" (default: 0).
   */
  set(key, data, { ttlMs, staleTtlMs = 0 } = {}) {
    const ttl = ttlMs ?? this._defaultTtlMs;
    const now = Date.now();

    // Evict oldest if at capacity
    if (this._store.size >= this._maxEntries && !this._store.has(key)) {
      const oldest = this._store.keys().next().value;
      if (oldest !== undefined) this._store.delete(oldest);
    }

    this._store.set(key, {
      data,
      expiresAt: now + ttl,
      staleAt: now + ttl + staleTtlMs,
    });
  }

  /**
   * Retrieve a cached value. Returns null if expired.
   * @param {string} key
   * @param {Object} [options]
   * @param {boolean} [options.allowStale=false]  Return stale data if within stale window.
   * @returns {{ data: any, isStale: boolean } | null}
   */
  get(key, { allowStale = false } = {}) {
    const entry = this._store.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now < entry.expiresAt) {
      return { data: entry.data, isStale: false };
    }
    if (allowStale && now < entry.staleAt) {
      return { data: entry.data, isStale: true };
    }

    // Expired — clean up
    this._store.delete(key);
    return null;
  }

  /**
   * Get cached data or fetch fresh data, storing the result.
   * Supports stale-while-revalidate: returns stale data immediately
   * while refetching in the background.
   *
   * @param {string} key
   * @param {() => Promise<any>} fetcher
   * @param {Object} [options]
   * @param {number} [options.ttlMs]
   * @param {number} [options.staleTtlMs]
   * @returns {Promise<any>}
   */
  async getOrFetch(key, fetcher, { ttlMs, staleTtlMs = 5_000 } = {}) {
    const cached = this.get(key, { allowStale: true });

    if (cached && !cached.isStale) {
      return cached.data;
    }

    // If stale, return stale data but revalidate in background
    if (cached?.isStale) {
      fetcher()
        .then((fresh) => this.set(key, fresh, { ttlMs, staleTtlMs }))
        .catch(() => {}); // Swallow — stale data is already returned
      return cached.data;
    }

    // Cache miss — fetch synchronously
    const data = await fetcher();
    this.set(key, data, { ttlMs, staleTtlMs });
    return data;
  }

  /** Invalidate a specific key. */
  invalidate(key) {
    this._store.delete(key);
  }

  /** Invalidate all keys matching a prefix (e.g., 'teams:' clears all team caches). */
  invalidateByPrefix(prefix) {
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) this._store.delete(key);
    }
  }

  /** Clear all cached data. */
  clear() {
    this._store.clear();
  }

  /** Current cache size. */
  get size() {
    return this._store.size;
  }
}

/**
 * Shared dashboard cache instance.
 * Default: 30s TTL, max 200 entries.
 */
export const dashboardCache = new TTLCache({ defaultTtlMs: 30_000, maxEntries: 200 });

export { TTLCache };
