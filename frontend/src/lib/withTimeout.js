/**
 * Race a thenable against a timeout. Resolves with the original value (or
 * rejection) if it finishes first; rejects with a timeout Error otherwise.
 * The timer is cleared in a `.finally` so it never leaks if the original
 * thenable settles before the deadline.
 *
 * Accepts `PromiseLike<T>` (not just `Promise<T>`) so Supabase's
 * PostgrestFilterBuilder / thenable builders work without an extra
 * `Promise.resolve(...)` wrap.
 *
 * Usage:
 *   const result = await withTimeout(supabase.rpc(...), 30000);
 *
 * @template T
 * @param {PromiseLike<T>} promise   The thenable to race.
 * @param {number}         ms        Timeout in milliseconds.
 * @param {string}         [label]   Optional label used in the timeout error
 *                                   message (defaults to 'Request').
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label = 'Request') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () =>
        reject(
          new Error(`${label} timed out after ${ms / 1000}s. Check your connection and try again.`)
        ),
      ms
    );
  });
  // Promise.resolve() normalizes PromiseLike → Promise so .finally works.
  return Promise.race([Promise.resolve(promise), timeoutPromise]).finally(() =>
    clearTimeout(timeoutId)
  );
}
