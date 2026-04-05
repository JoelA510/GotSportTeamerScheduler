/**
 * Production-safe logger utility (Phase 4, L-1).
 *
 * - logger.log / logger.warn — dev-only, silenced in production builds.
 * - logger.error — always active (genuine errors should surface in monitoring).
 *
 * Usage:  import { logger } from '../lib/logger.js';
 *         logger.log('debug info', data);
 */

const isDev =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.DEV
    : typeof process !== 'undefined' && process.env
      ? process.env.NODE_ENV !== 'production'
      : true;

export const logger = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },
  warn: (...args) => {
    if (isDev) console.warn(...args);
  },
  error: (...args) => {
    console.error(...args);
  },
};
