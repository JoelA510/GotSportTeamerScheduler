/**
 * Production-safe logger utility (Phase 4, enhanced Phase 9).
 *
 * - logger.log / logger.warn — dev-only, silenced in production builds.
 * - logger.error — always active; forwards to Sentry when configured.
 * - logger.captureException — explicit Sentry error capture with optional context.
 * - logger.setUser — attach user identity to all future Sentry events.
 *
 * Sentry integration uses the @sentry/react SDK (installed as a dependency).
 * When VITE_SENTRY_DSN is absent, the SDK is imported but init() was never
 * called (see main.jsx), so all capture calls are harmless no-ops.
 *
 * Usage:
 *   import { logger } from '../lib/logger.js';
 *   logger.log('debug info', data);
 *   logger.captureException(error, { extra: { teamId } });
 */

import * as Sentry from '@sentry/react';

// ---------------------------------------------------------------------------
// Logger API
// ---------------------------------------------------------------------------

export const logger = {
  log: (...args) => {
    if (!import.meta.env.PROD) console.log(...args);
  },

  // `info` is an alias for `log` — matches the standard console API so call
  // sites like `logger.info('event', payload)` don't silently crash.
  info: (...args) => {
    if (!import.meta.env.PROD) console.info(...args);
  },

  warn: (...args) => {
    if (!import.meta.env.PROD) console.warn(...args);
  },

  error: (...args) => {
    console.error(...args);
    // Forward genuine errors to Sentry
    const err = args.find((a) => a instanceof Error);
    if (err) {
      Sentry.captureException(err);
    } else {
      Sentry.captureMessage(args.map(String).join(' '), 'error');
    }
  },

  /**
   * Explicitly capture an exception with optional context.
   * @param {Error} error
   * @param {{ extra?: Record<string, any>, tags?: Record<string, string> }} [ctx]
   */
  captureException: (error, ctx) => {
    console.error(error);
    if (ctx) {
      Sentry.withScope((scope) => {
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
        Sentry.captureException(error);
      });
    } else {
      Sentry.captureException(error);
    }
  },

  /**
   * Associate a user identity with future Sentry events.
   * Call on login; call with null on logout.
   * @param {{ id: string, email?: string, role?: string } | null} user
   */
  setUser: (user) => {
    Sentry.setUser(user);
  },
};
