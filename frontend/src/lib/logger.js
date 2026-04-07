/**
 * Production-safe logger utility (Phase 4, enhanced Phase 9).
 *
 * - logger.log / logger.warn — dev-only, silenced in production builds.
 * - logger.error — always active; forwards to Sentry when configured.
 * - logger.captureException — explicit Sentry error capture with optional context.
 * - logger.setUser — attach user identity to all future Sentry events.
 *
 * Sentry integration is lazy-loaded and gated behind the VITE_SENTRY_DSN
 * environment variable. When the DSN is absent, all Sentry calls are no-ops.
 *
 * Usage:
 *   import { logger } from '../lib/logger.js';
 *   logger.log('debug info', data);
 *   logger.captureException(error, { extra: { teamId } });
 */

const isDev =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.DEV
    : typeof process !== 'undefined' && process.env
      ? process.env.NODE_ENV !== 'production'
      : true;

// ---------------------------------------------------------------------------
// Sentry integration (lazy, optional)
// ---------------------------------------------------------------------------

/** @type {any} */
let _sentry = null;
let _sentryInitialized = false;

/**
 * Lazily initialise Sentry on first error capture.
 * Avoids blocking the main bundle with an eager import when the DSN is unset.
 */
async function getSentry() {
  if (_sentryInitialized) return _sentry;
  _sentryInitialized = true;

  const dsn =
    typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_SENTRY_DSN
      : undefined;

  if (!dsn) return null;

  try {
    // @ts-expect-error — CDN import has no local type declarations
    const Sentry = await import(/* @vite-ignore */ 'https://esm.sh/@sentry/browser@8');
    Sentry.init({
      dsn,
      environment: isDev ? 'development' : 'production',
      // Keep sample rate low for free tier (10k events/mo)
      tracesSampleRate: isDev ? 1.0 : 0.1,
      // Filter noisy console breadcrumbs in dev
      beforeBreadcrumb(breadcrumb) {
        if (isDev && breadcrumb.category === 'console') return null;
        return breadcrumb;
      },
    });
    _sentry = Sentry;
    return Sentry;
  } catch {
    // Sentry SDK unavailable — graceful no-op
    return null;
  }
}

// ---------------------------------------------------------------------------
// Logger API
// ---------------------------------------------------------------------------

export const logger = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },

  warn: (...args) => {
    if (isDev) console.warn(...args);
  },

  error: (...args) => {
    console.error(...args);
    // Forward genuine errors to Sentry
    const err = args.find((a) => a instanceof Error);
    if (err) {
      getSentry().then((s) => s?.captureException(err));
    } else {
      getSentry().then((s) => s?.captureMessage(args.map(String).join(' '), 'error'));
    }
  },

  /**
   * Explicitly capture an exception with optional context.
   * @param {Error} error
   * @param {{ extra?: Record<string, any>, tags?: Record<string, string> }} [ctx]
   */
  captureException: (error, ctx) => {
    console.error(error);
    getSentry().then((s) => {
      if (!s) return;
      if (ctx) {
        s.withScope((scope) => {
          if (ctx.extra) {
            for (const [k, v] of Object.entries(ctx.extra)) {
              scope.setExtra(k, v);
            }
          }
          if (ctx.tags) {
            for (const [k, v] of Object.entries(ctx.tags)) {
              scope.setTag(k, v);
            }
          }
          s.captureException(error);
        });
      } else {
        s.captureException(error);
      }
    });
  },

  /**
   * Associate a user identity with future Sentry events.
   * Call on login; call with null on logout.
   * @param {{ id: string, email?: string, role?: string } | null} user
   */
  setUser: (user) => {
    getSentry().then((s) => s?.setUser(user));
  },
};
