/**
 * In-memory per-user rate limiter for Edge Functions (Phase 3.2, Finding M-4).
 *
 * Uses a simple sliding-window counter stored in a Map. Each Edge Function
 * instance runs in its own isolate, so this limits per-instance concurrency
 * rather than globally — but it's sufficient to prevent a single user from
 * flooding the endpoint. For global rate limiting, Supabase's built-in
 * API gateway limits also apply.
 *
 * Defaults: 60 requests per minute per user. Configurable per function.
 *
 * Usability note: 60 req/min is well above any legitimate usage pattern.
 * A coach saving a team roster triggers 1 request. Even rapid clicking
 * during a draft would generate ~5-10 requests/minute.
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > windowMs * 2) {
      store.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum requests allowed in the window. Default: 60 */
  maxRequests?: number;
  /** Window size in milliseconds. Default: 60000 (1 minute) */
  windowMs?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Check if a request from this user is within the rate limit.
 * Call this with the authenticated user's ID before processing.
 */
export function checkRateLimit(
  userId: string,
  config: RateLimitConfig = {}
): RateLimitResult {
  const maxRequests = config.maxRequests ?? 60;
  const windowMs = config.windowMs ?? 60_000;

  cleanup(windowMs);

  const now = Date.now();
  const key = userId;
  const entry = store.get(key);

  if (!entry || now - entry.windowStart > windowMs) {
    // New window
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxRequests - 1, retryAfterMs: 0 };
  }

  if (entry.count >= maxRequests) {
    const retryAfterMs = windowMs - (now - entry.windowStart);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  entry.count++;
  return { allowed: true, remaining: maxRequests - entry.count, retryAfterMs: 0 };
}

/**
 * Express-style Response helper for rate limit exceeded.
 */
export function rateLimitExceededResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      status: 'error',
      message: 'Rate limit exceeded. Please try again shortly.',
      retry_after_ms: result.retryAfterMs,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil(result.retryAfterMs / 1000)),
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    }
  );
}
